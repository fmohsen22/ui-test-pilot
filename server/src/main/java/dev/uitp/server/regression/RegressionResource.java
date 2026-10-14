package dev.uitp.server.regression;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import dev.uitp.server.auth.CurrentUser;
import dev.uitp.server.llm.LlmClient;
import dev.uitp.server.model.EventLog;
import dev.uitp.server.runner.ScenarioStore;
import dev.uitp.server.runner.UitpCli;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Path("/api/regression")
@Produces(MediaType.APPLICATION_JSON)
public class RegressionResource {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Inject
    CurrentUser currentUser;

    @Inject
    ScenarioStore store;

    @Inject
    UitpCli cli;

    @Inject
    LlmClient llm;

    @Inject
    dev.uitp.server.llm.CodexCli codex;

    @ConfigProperty(name = "llm.heal-attempts")
    int healAttempts;

    @ConfigProperty(name = "llm.provider")
    String provider;

    private boolean healerConfigured() {
        return "codex".equalsIgnoreCase(provider) || llm.configured();
    }

    public record SaveRequest(String path, String content) {
    }

    public record RunRequest(String path, boolean heal, String browser) {
    }

    @GET
    @Path("/tree")
    public Map<String, List<Map<String, Object>>> tree() {
        currentUser.require();
        return store.tree();
    }

    @GET
    @Path("/scenario")
    public Map<String, Object> scenario(@QueryParam("path") String path) throws Exception {
        currentUser.require();
        String raw = store.read(path);
        JsonNode json = MAPPER.readTree(raw);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("path", path);
        out.put("id", json.path("id").asText(""));
        out.put("title", json.path("title").asText(""));
        out.put("raw", raw);
        out.put("explained", Simplifier.explain(json));
        return out;
    }

    @PUT
    @Path("/scenario")
    @Transactional
    public Map<String, Object> save(SaveRequest req) {
        var user = currentUser.require();
        if (req == null || req.path() == null || req.content() == null) {
            throw new BadRequestException("path and content required");
        }
        store.write(req.path(), req.content());
        UitpCli.Result validation = cli.validate(req.path());
        EventLog.log("INFO", user.email, "regression.save", req.path());
        return Map.of("saved", true, "validate", validation.json());
    }

    @Inject
    dev.uitp.server.chat.ChatTx tx;

    /**
     * Run one scenario; with heal=true, on failure the model repairs the JSON and re-runs
     * (up to N attempts). NOT @Transactional on purpose — runs take minutes; DB writes go
     * through short ChatTx transactions.
     */
    @POST
    @Path("/run")
    public Map<String, Object> run(RunRequest req) {
        var user = currentUser.require();
        if (req == null || req.path() == null) throw new BadRequestException("path required");
        String browser = UitpCli.browserOrDefault(req.browser());
        long started = System.currentTimeMillis();

        List<Map<String, Object>> attempts = new ArrayList<>();
        UitpCli.Result result = cli.run(req.path(), null, browser);
        attempts.add(attempt(1, result, null));

        int attempt = 1;
        while (!result.passed() && result.exitCode() == 1 && req.heal() && attempt <= healAttempts) {
            if (!healerConfigured()) {
                attempts.add(Map.of("note",
                        "self-heal skipped: no model configured (set UITP_LLM_API_KEY, or UITP_LLM_PROVIDER=codex)"));
                break;
            }
            attempt++;
            try {
                if ("codex".equalsIgnoreCase(provider)) {
                    healViaCodex(req.path(), result.json());   // codex edits the file in place
                } else {
                    store.write(req.path(), heal(store.read(req.path()), result.json()));
                }
            } catch (Exception e) {
                tx.log("ERROR", user.email, "regression.heal", e.toString());
                attempts.add(Map.of("note", "heal attempt failed: " + e.getMessage()));
                break;
            }
            result = cli.run(req.path(), null, browser);
            attempts.add(attempt(attempt, result, "healed then re-ran"));
        }

        tx.log(result.passed() ? "INFO" : "ERROR", user.email, "regression.run",
                req.path() + " -> exit " + result.exitCode() + " after " + attempts.size() + " attempt(s)");

        dev.uitp.server.model.TestRun runRow = new dev.uitp.server.model.TestRun();
        runRow.scenarioPath = req.path();
        runRow.scenarioId = result.json().path("scenarioId").asText("");
        runRow.browser = browser;
        runRow.passed = result.passed();
        runRow.exitCode = result.exitCode();
        runRow.attempts = attempts.size();
        runRow.healed = attempts.size() > 1 && result.passed();
        runRow.durationMs = System.currentTimeMillis() - started;
        runRow.userEmail = user.email;
        runRow.screenshot = artifactRel(result.json().path("finalScreenshot").asText(null));
        try {
            runRow.reportJson = MAPPER.writeValueAsString(attempts);
        } catch (Exception ignored) {
        }
        tx.testRun(runRow);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("passed", result.passed());
        out.put("exitCode", result.exitCode());
        out.put("browser", browser);
        out.put("attempts", attempts);
        out.put("finalReport", result.json());
        out.put("screenshot", runRow.screenshot);
        try {
            out.put("scenario", scenario(req.path()));
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Absolute artifact path -> path relative to the project dir (for the artifact endpoint), or null. */
    private String artifactRel(String absolute) {
        if (absolute == null || absolute.isBlank()) return null;
        try {
            java.nio.file.Path base = cli.projectDir();
            java.nio.file.Path p = java.nio.file.Path.of(absolute).toAbsolutePath().normalize();
            return p.startsWith(base) ? base.relativize(p).toString().replace('\\', '/') : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Serves run artifacts (screenshots) from inside the project dir — path-traversal safe. */
    @GET
    @Path("/artifact")
    @Produces("image/png")
    public byte[] artifact(@QueryParam("path") String relPath) throws java.io.IOException {
        currentUser.require();
        if (relPath == null || relPath.isBlank()) throw new BadRequestException("path required");
        java.nio.file.Path base = cli.projectDir();
        java.nio.file.Path p = base.resolve(relPath).normalize();
        if (!p.startsWith(base) || !p.toString().endsWith(".png") || !java.nio.file.Files.exists(p)) {
            throw new jakarta.ws.rs.NotFoundException();
        }
        return java.nio.file.Files.readAllBytes(p);
    }

    /** Run history for the Results menu, newest first. */
    @GET
    @Path("/results")
    public List<Map<String, Object>> results(@QueryParam("scenario") String scenario) {
        currentUser.require();
        List<dev.uitp.server.model.TestRun> runs = scenario == null || scenario.isBlank()
                ? dev.uitp.server.model.TestRun.list("order by id desc")
                : dev.uitp.server.model.TestRun.list("scenarioPath = ?1 order by id desc", scenario);
        List<Map<String, Object>> out = new ArrayList<>();
        for (dev.uitp.server.model.TestRun r : runs.subList(0, Math.min(runs.size(), 200))) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id);
            m.put("ts", r.ts.toString());
            m.put("scenarioPath", r.scenarioPath);
            m.put("scenarioId", r.scenarioId);
            m.put("browser", r.browser);
            m.put("passed", r.passed);
            m.put("exitCode", r.exitCode);
            m.put("attempts", r.attempts);
            m.put("healed", r.healed);
            m.put("durationMs", r.durationMs);
            m.put("user", r.userEmail == null ? "" : r.userEmail);
            m.put("screenshot", r.screenshot);
            m.put("report", r.reportJson);
            out.add(m);
        }
        return out;
    }

    /** Codex-provider heal: Codex edits the failing scenario file in place inside the project dir. */
    private void healViaCodex(String relPath, JsonNode failureReport) {
        String prompt = """
                The UI test scenario file %s failed when run by the uitp runner.
                Failure report (failed step index, error, fresh DOM digest with ranked selectors):
                %s
                Edit the file %s IN PLACE to fix ONLY what is needed to make it pass — usually the
                failing step's target selector candidates or a missing waitFor. Do not change ids,
                titles or descriptions unless required. Keep it valid scenario JSON (schemaVersion 1).
                Do not run the scenario yourself; the server re-runs it after you finish.
                """.formatted(relPath, failureReport.toString(), relPath);
        var result = codex.exec(prompt, cli.projectDir());
        if (result.exitCode() != 0 && result.finalMessage().isBlank()) {
            throw new IllegalStateException("codex heal failed: " + result.transcript()
                    .substring(Math.max(0, result.transcript().length() - 500)));
        }
    }

    /** Single-shot heal: failure report + current JSON -> corrected full scenario JSON. */
    private String heal(String currentJson, JsonNode failureReport) {
        ArrayNode messages = MAPPER.createArrayNode();
        messages.add(msg("system", """
                You repair UI test scenarios for the deterministic uitp runner.
                You get the current scenario JSON and the runner's failure report (failed step index,
                error, fresh DOM digest with ranked selectors). Fix ONLY what is needed to make the
                scenario pass — usually the failing step's target candidates or a missing waitFor.
                Do not change passing steps, ids, titles or descriptions unless required.
                Answer with the COMPLETE corrected scenario JSON and nothing else — no markdown fences.
                """));
        messages.add(msg("user", "Current scenario:\n" + currentJson
                + "\n\nFailure report:\n" + failureReport.toString()));
        JsonNode reply = llm.chat(messages, null);
        String text = reply.path("content").asText("").trim();
        if (text.startsWith("```")) {
            text = text.replaceAll("^```(json)?\\s*", "").replaceAll("\\s*```\\s*$", "");
        }
        return text;
    }

    private static Map<String, Object> attempt(int n, UitpCli.Result r, String note) {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("attempt", n);
        a.put("exitCode", r.exitCode());
        a.put("passed", r.passed());
        if (note != null) a.put("note", note);
        a.put("report", r.json());
        return a;
    }

    private static JsonNode msg(String role, String content) {
        var m = MAPPER.createObjectNode();
        m.put("role", role);
        m.put("content", content);
        return m;
    }
}
