package dev.uitp.server.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.uitp.server.llm.LlmClient;
import dev.uitp.server.model.ChatMessage;
import dev.uitp.server.model.Conversation;
import dev.uitp.server.model.EventLog;
import dev.uitp.server.runner.ScenarioStore;
import dev.uitp.server.runner.UitpCli;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.ArrayList;
import java.util.List;

/**
 * The chat agent loop: user message -> LLM (with uitp tools) -> execute tool
 * calls against the runner -> feed results back -> ... -> final assistant text.
 * Every tool execution is persisted as a role=tool ChatMessage so the
 * conversation history shows exactly what was done.
 */
@ApplicationScoped
public class Orchestrator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Inject
    LlmClient llm;

    @Inject
    dev.uitp.server.llm.CodexCli codex;

    @Inject
    UitpCli cli;

    @Inject
    ScenarioStore store;

    @ConfigProperty(name = "llm.max-tool-iterations")
    int maxIterations;

    @ConfigProperty(name = "llm.provider")
    String provider;

    static final String SYSTEM_PROMPT = """
            You are UI Test Pilot, an agent that authors, runs and heals UI test scenarios.
            Scenarios are JSON files executed by the deterministic `uitp` Playwright runner.

            Scenario contract (schemaVersion 1):
            - Top level: schemaVersion, id (kebab-case), title, feature ("<area>/<flow>"), tags[], optional env.required[], steps[].
            - Each step: "description" (human intent, ALWAYS present), "action", and for element actions a "target"
              ARRAY of ranked selector candidates tried in order:
              {"strategy":"testid|id|role|label|placeholder|text|css","value":"...", optional "name","exact"}.
            - Actions: goto (value=path or URL), click, fill (value=text), press (value=key), waitFor
              ({"url":"glob"} or a target), expect (assertions: visible/text/url/value), http (API call), select, check.
            - Secrets: "value":"${ENV_VAR}" plus "secret":true and env.required — never inline real secrets.

            Workflow you MUST follow when asked to create or fix a test:
            1. snapshot the relevant page URL to get the DOM digest (ranked selectors per element).
            2. Write the scenario with write_scenario (path "scenarios/<feature>/<id>.json"). Prefer testid/id/role/label
               selectors from the digest; give 2-4 candidates per target. Every step needs a clear description.
            3. run_scenario. If it fails: read the failure report (failed step index, error, fresh digest),
               fix ONLY what is wrong (usually one step's target or a wait), write_scenario again, re-run.
            4. Repeat until green, then summarise for the user in plain language: what the test does, step by step,
               where the file is, and the run result.
            For multi-page flows use run_scenario with untilStep to advance incrementally and snapshot after redirects.
            When the user asks to explain a test, read_scenario and explain each step's description in simple words.
            Keep answers short and concrete. Never invent selectors that were not in a digest or an existing scenario.
            """;

    public record ToolEvent(String tool, String args, String result) {
    }

    public record Reply(String text, List<ToolEvent> events) {
    }

    /** Runs the agent loop. Persists tool messages into the conversation as it goes. */
    public Reply respond(Conversation conversation, List<ChatMessage> history) {
        if ("codex".equalsIgnoreCase(provider)) {
            return respondViaCodex(conversation, history);
        }
        ArrayNode messages = MAPPER.createArrayNode();
        messages.add(msg("system", SYSTEM_PROMPT + "\nProject dir: " + cli.projectDir()));
        for (ChatMessage m : history) {
            if ("tool".equals(m.role)) {
                // replay tool results as assistant context (keeps the transcript model-agnostic)
                messages.add(msg("assistant", "[tool " + m.toolName + " result]\n" + m.content));
            } else {
                messages.add(msg(m.role, m.content));
            }
        }

        List<ToolEvent> events = new ArrayList<>();
        for (int i = 0; i < maxIterations; i++) {
            JsonNode reply = llm.chat(messages, toolDefs());
            JsonNode toolCalls = reply.path("tool_calls");
            if (!toolCalls.isArray() || toolCalls.isEmpty()) {
                String text = reply.path("content").asText("");
                return new Reply(text.isBlank() ? "(no answer)" : text, events);
            }
            // execute each requested tool, append results, loop again
            ObjectNode assistantMsg = MAPPER.createObjectNode();
            assistantMsg.put("role", "assistant");
            assistantMsg.putNull("content");
            assistantMsg.set("tool_calls", toolCalls);
            messages.add(assistantMsg);
            for (JsonNode call : toolCalls) {
                String name = call.path("function").path("name").asText();
                String argsRaw = call.path("function").path("arguments").asText("{}");
                String result = executeTool(name, argsRaw);
                events.add(new ToolEvent(name, argsRaw, result));
                persistToolMessage(conversation, name, argsRaw, result);
                ObjectNode toolMsg = MAPPER.createObjectNode();
                toolMsg.put("role", "tool");
                toolMsg.put("tool_call_id", call.path("id").asText());
                toolMsg.put("content", truncate(result, 60_000));
                messages.add(toolMsg);
            }
        }
        return new Reply("Stopped after " + maxIterations
                + " tool steps without a final answer. The partial work is logged above — "
                + "send a follow-up message to continue.", events);
    }

    /**
     * Codex-provider path: Codex IS an agent — instead of a tool-calling loop we hand
     * it the whole task once; it runs the uitp CLI and edits scenario files itself
     * inside the project dir, then reports back. Auth comes from `codex login`
     * (the user's ChatGPT account), so no API key is involved.
     */
    private Reply respondViaCodex(Conversation conversation, List<ChatMessage> history) {
        StringBuilder prompt = new StringBuilder();
        prompt.append(SYSTEM_PROMPT);
        prompt.append("\nYou are running inside the project dir. The uitp runner is invoked as:\n  node ")
                .append(cliJsPath())
                .append(" <snapshot|run|run-all|validate> ...\n")
                .append("Author scenario files under scenarios/ yourself with your file tools.\n");
        prompt.append("\nConversation so far:\n");
        for (ChatMessage m : history) {
            if ("tool".equals(m.role)) continue;
            prompt.append(m.role.equals("user") ? "USER: " : "ASSISTANT: ")
                    .append(m.content).append("\n");
        }
        prompt.append("\nRespond to the last USER message. Do the work now; your final message is shown to the user.");

        var result = codex.exec(prompt.toString(), cli.projectDir());
        persistToolMessage(conversation, "codex",
                "exec in " + cli.projectDir(), truncate(result.transcript(), 20_000));
        String text = result.finalMessage().isBlank()
                ? "Codex returned no message (exit " + result.exitCode() + ") — see the codex tool entry above."
                : result.finalMessage();
        return new Reply(text, List.of(new ToolEvent("codex", "", truncate(result.transcript(), 2000))));
    }

    private String cliJsPath() {
        return java.nio.file.Path.of(
                org.eclipse.microprofile.config.ConfigProvider.getConfig()
                        .getValue("uitp.pilot-dir", String.class))
                .toAbsolutePath().normalize().resolve("dist/cli.js").toString();
    }

    String executeTool(String name, String argsRaw) {
        try {
            JsonNode args = MAPPER.readTree(argsRaw.isBlank() ? "{}" : argsRaw);
            UitpCli.Result r;
            switch (name) {
                case "list_scenarios" -> {
                    return MAPPER.writeValueAsString(store.tree());
                }
                case "read_scenario" -> {
                    return store.read(args.path("path").asText());
                }
                case "write_scenario" -> {
                    String path = args.path("path").asText();
                    String content = args.path("content").isTextual()
                            ? args.path("content").asText()
                            : MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(args.path("content"));
                    store.write(path, content);
                    UitpCli.Result v = cli.validate(path);
                    return "{\"saved\":\"" + path + "\",\"validate\":" + v.json().toString() + "}";
                }
                case "snapshot" -> r = cli.snapshot(args.path("url").asText(), args.path("full").asBoolean(false));
                case "run_scenario" -> r = cli.run(args.path("path").asText(),
                        args.hasNonNull("untilStep") ? args.path("untilStep").asInt() : null);
                case "run_all" -> r = cli.runAll(args.path("dir").asText("scenarios"),
                        args.hasNonNull("grep") ? args.path("grep").asText() : null);
                default -> {
                    return "{\"error\":\"unknown tool " + name + "\"}";
                }
            }
            ObjectNode out = MAPPER.createObjectNode();
            out.put("exitCode", r.exitCode());
            out.set("output", r.json());
            return MAPPER.writeValueAsString(out);
        } catch (Exception e) {
            EventLog.log("ERROR", null, "tool." + name, e.toString());
            return "{\"error\":" + jsonString(e.toString()) + "}";
        }
    }

    @Inject
    ChatTx tx;

    private void persistToolMessage(Conversation conversation, String tool, String args, String result) {
        tx.toolMessage(conversation.id, tool,
                "args: " + truncate(args, 4000) + "\nresult: " + truncate(result, 20_000));
    }

    static ArrayNode toolDefs() {
        ArrayNode tools = MAPPER.createArrayNode();
        tools.add(tool("list_scenarios", "List all saved test scenarios grouped by feature folder.",
                MAPPER.createObjectNode().put("type", "object")));
        tools.add(tool("read_scenario", "Read one scenario JSON file.", objSchema("path",
                "Scenario path relative to the project dir, e.g. scenarios/auth/login.json")));
        tools.add(tool("write_scenario", "Create or overwrite a scenario JSON file (validated after save).",
                objSchema2()));
        tools.add(tool("snapshot", "Capture the DOM digest of a live page (ranked selectors per element).",
                objSchema("url", "Absolute URL or path relative to the project baseUrl")));
        tools.add(tool("run_scenario", "Run one scenario; on failure returns the healable failure report.",
                objSchema("path", "Scenario path, e.g. scenarios/auth/login.json")));
        tools.add(tool("run_all", "Run every scenario in a directory (regression run).",
                objSchema("dir", "Directory relative to the project dir, default scenarios")));
        return tools;
    }

    private static ObjectNode tool(String name, String description, ObjectNode params) {
        ObjectNode fn = MAPPER.createObjectNode();
        fn.put("name", name);
        fn.put("description", description);
        fn.set("parameters", params);
        ObjectNode t = MAPPER.createObjectNode();
        t.put("type", "function");
        t.set("function", fn);
        return t;
    }

    private static ObjectNode objSchema(String prop, String desc) {
        ObjectNode schema = MAPPER.createObjectNode();
        schema.put("type", "object");
        ObjectNode props = schema.putObject("properties");
        props.putObject(prop).put("type", "string").put("description", desc);
        schema.putArray("required").add(prop);
        return schema;
    }

    private static ObjectNode objSchema2() {
        ObjectNode schema = MAPPER.createObjectNode();
        schema.put("type", "object");
        ObjectNode props = schema.putObject("properties");
        props.putObject("path").put("type", "string")
                .put("description", "Target path, e.g. scenarios/auth/login-wrong-username.json");
        props.putObject("content").put("type", "string")
                .put("description", "The full scenario JSON as a string");
        schema.putArray("required").add("path").add("content");
        return schema;
    }

    private static ObjectNode msg(String role, String content) {
        ObjectNode m = MAPPER.createObjectNode();
        m.put("role", role);
        m.put("content", content);
        return m;
    }

    private static String truncate(String s, int max) {
        return s != null && s.length() > max ? s.substring(0, max) + "…[truncated]" : s;
    }

    private static String jsonString(String s) {
        try {
            return MAPPER.writeValueAsString(s);
        } catch (Exception e) {
            return "\"error\"";
        }
    }
}
