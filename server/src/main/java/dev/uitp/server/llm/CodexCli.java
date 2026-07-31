package dev.uitp.server.llm;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Chat backend using the locally installed OpenAI Codex CLI (`codex exec`),
 * authenticated via the user's ChatGPT account (`codex login`) — no API key.
 * Codex is itself an agent: it runs the uitp CLI, edits scenario files in the
 * project dir (workspace-write sandbox) and returns a final summary message.
 */
@ApplicationScoped
public class CodexCli {

    public record Result(int exitCode, String finalMessage, String transcript) {
    }

    @ConfigProperty(name = "codex.bin")
    String bin;

    @ConfigProperty(name = "codex.model")
    Optional<String> model;

    @ConfigProperty(name = "codex.timeout-seconds")
    long timeoutSeconds;

    public Result exec(String prompt, Path workDir) {
        return exec(prompt, workDir, null);
    }

    public Result exec(String prompt, Path workDir, String browser) {
        try {
            Path lastMessage = Files.createTempFile("uitp-codex-", ".txt");
            List<String> cmd = new ArrayList<>(List.of(
                    bin, "exec",
                    "--skip-git-repo-check",
                    "--sandbox", "workspace-write",
                    "-C", workDir.toString(),
                    "-o", lastMessage.toString()));
            model.filter(m -> !m.isBlank()).ifPresent(m -> {
                cmd.add("-m");
                cmd.add(m);
            });
            cmd.add(prompt);

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            if (browser != null) pb.environment().put("UITP_BROWSER", browser);
            // stdin MUST be closed (null device): codex waits forever on an open-but-empty
            // stdin pipe when spawned from a server process
            pb.redirectInput(ProcessBuilder.Redirect.from(nullDevice()));
            Process p = pb.start();
            String transcript = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            boolean finished = p.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                return new Result(3, "", "codex timed out after " + timeoutSeconds + "s\n" + transcript);
            }
            String finalMessage = Files.exists(lastMessage)
                    ? Files.readString(lastMessage, StandardCharsets.UTF_8).trim() : "";
            Files.deleteIfExists(lastMessage);
            if (finalMessage.isBlank()) {
                // fallback: last non-empty lines of the transcript
                String[] lines = transcript.strip().split("\n");
                int from = Math.max(0, lines.length - 15);
                finalMessage = String.join("\n", List.of(lines).subList(from, lines.length));
            }
            return new Result(p.exitValue(), finalMessage, transcript);
        } catch (Exception e) {
            return new Result(3, "", "codex invocation failed: " + e
                    + "\nIs the Codex CLI installed (npm i -g @openai/codex) and logged in (codex login)?");
        }
    }

    public static java.io.File nullDevice() {
        return new java.io.File(
                System.getProperty("os.name", "").toLowerCase().contains("win") ? "NUL" : "/dev/null");
    }
}
