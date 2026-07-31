package dev.uitp.server.runner;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Cross-platform wrapper around the uitp CLI (node dist/cli.js ...).
 * stdout of every uitp command is exactly one JSON document; exit codes:
 * 0 pass, 1 scenario failed (healable), 2 invalid scenario, 3 infrastructure.
 */
@ApplicationScoped
public class UitpCli {

    public record Result(int exitCode, JsonNode json, String rawStdout, String stderr) {
        public boolean passed() {
            return exitCode == 0;
        }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @ConfigProperty(name = "uitp.pilot-dir")
    String pilotDir;

    @ConfigProperty(name = "uitp.project-dir")
    String projectDir;

    @ConfigProperty(name = "uitp.node-bin")
    String nodeBin;

    @ConfigProperty(name = "uitp.cli-timeout-seconds")
    long timeoutSeconds;

    public Path projectDir() {
        return Path.of(projectDir).toAbsolutePath().normalize();
    }

    private volatile String resolvedNode;

    /** The runner needs Node >= 22; dev machines often default to an older node.
     *  If the configured binary is too old, auto-discover the newest nvm-installed >= 22. */
    String nodeBin() {
        if (resolvedNode != null) return resolvedNode;
        synchronized (this) {
            if (resolvedNode != null) return resolvedNode;
            if (nodeMajor(nodeBin) >= 22) return resolvedNode = nodeBin;
            java.io.File versions = new java.io.File(System.getProperty("user.home"), ".nvm/versions/node");
            java.io.File[] dirs = versions.listFiles();
            if (dirs != null) {
                java.util.Arrays.sort(dirs, java.util.Comparator.comparing(java.io.File::getName).reversed());
                for (java.io.File d : dirs) {
                    java.io.File candidate = new java.io.File(d, "bin/node");
                    if (candidate.canExecute() && nodeMajor(candidate.getAbsolutePath()) >= 22) {
                        return resolvedNode = candidate.getAbsolutePath();
                    }
                }
            }
            return resolvedNode = nodeBin; // let the runner emit its clear version error
        }
    }

    private static int nodeMajor(String bin) {
        try {
            Process p = new ProcessBuilder(bin, "--version").start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            p.waitFor(10, TimeUnit.SECONDS);
            return Integer.parseInt(out.replaceFirst("^v", "").split("\\.")[0]);
        } catch (Exception e) {
            return -1;
        }
    }

    private Path cliJs() {
        return Path.of(pilotDir).toAbsolutePath().normalize().resolve("dist/cli.js");
    }

    /** Normalizes a UI-provided browser name; null/unknown -> chromium. */
    public static String browserOrDefault(String browser) {
        if (browser == null) return "chromium";
        String b = browser.toLowerCase().trim();
        return (b.equals("firefox") || b.equals("webkit")) ? b : "chromium";
    }

    public Result snapshot(String url, boolean full, String browser) {
        List<String> args = new ArrayList<>(List.of("snapshot", "--url", url));
        if (full) args.add("--full");
        return exec(args, browser);
    }

    public Result run(String scenarioRelPath, Integer untilStep, String browser) {
        List<String> args = new ArrayList<>(List.of("run", scenarioRelPath));
        if (untilStep != null) {
            args.add("--until-step");
            args.add(String.valueOf(untilStep));
        }
        return exec(args, browser);
    }

    public Result runAll(String dirRelPath, String grep, String browser) {
        List<String> args = new ArrayList<>(List.of("run-all", dirRelPath));
        if (grep != null && !grep.isBlank()) {
            args.add("--grep");
            args.add(grep);
        }
        return exec(args, browser);
    }

    public Result validate(String scenarioRelPath) {
        return exec(new ArrayList<>(List.of("validate", scenarioRelPath)), null);
    }

    private Result exec(List<String> uitpArgs, String browser) {
        Path cli = cliJs();
        if (!Files.exists(cli)) {
            return new Result(3, MAPPER.createObjectNode()
                    .put("error", "uitp runner not built: " + cli + " missing. Run `npm run build` in the ui-test-pilot checkout."),
                    "", "");
        }
        List<String> cmd = new ArrayList<>();
        cmd.add(nodeBin());
        cmd.add(cli.toString());
        cmd.addAll(uitpArgs);
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.directory(projectDir().toFile());
            pb.environment().put("UITP_BROWSER", browserOrDefault(browser));
            pb.redirectInput(ProcessBuilder.Redirect.from(dev.uitp.server.llm.CodexCli.nullDevice()));
            Process p = pb.start();
            String stdout = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String stderr = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = p.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                return new Result(3, MAPPER.createObjectNode()
                        .put("error", "uitp timed out after " + timeoutSeconds + "s"), stdout, stderr);
            }
            JsonNode json;
            try {
                json = stdout.isBlank() ? MAPPER.createObjectNode() : MAPPER.readTree(stdout);
            } catch (IOException e) {
                json = MAPPER.createObjectNode().put("error", "non-JSON stdout from uitp").put("stdout", stdout);
            }
            return new Result(p.exitValue(), json, stdout, stderr);
        } catch (Exception e) {
            return new Result(3, MAPPER.createObjectNode().put("error", e.toString()), "", "");
        }
    }
}
