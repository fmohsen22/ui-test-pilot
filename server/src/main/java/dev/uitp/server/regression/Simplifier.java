package dev.uitp.server.regression;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;

/**
 * Deterministic scenario-JSON -> plain-language rendering. No LLM involved:
 * step descriptions are authored to carry intent, so the explanation reads
 * naturally and is always available even without an API key.
 */
public final class Simplifier {

    private Simplifier() {
    }

    public static List<String> explain(JsonNode scenario) {
        List<String> lines = new ArrayList<>();
        JsonNode steps = scenario.path("steps");
        int i = 1;
        for (JsonNode step : steps) {
            String description = step.path("description").asText("");
            String action = step.path("action").asText("");
            String detail = switch (action) {
                case "goto" -> "open " + step.path("value").asText("");
                case "click" -> "click " + targetHint(step);
                case "fill" -> "type " + valueHint(step) + " into " + targetHint(step);
                case "press" -> "press key " + step.path("value").asText("");
                case "select" -> "select " + valueHint(step) + " in " + targetHint(step);
                case "check" -> "check " + targetHint(step);
                case "waitFor" -> "wait for " + waitHint(step);
                case "expect" -> "verify " + expectHint(step);
                case "http" -> "call API " + step.path("http").path("method").asText("GET")
                        + " " + step.path("http").path("url").asText("");
                default -> action;
            };
            String line = "Step " + i + ": " + (description.isBlank() ? detail : description);
            if (!description.isBlank() && !detail.isBlank()) line += "  [" + detail + "]";
            lines.add(line);
            i++;
        }
        return lines;
    }

    private static String targetHint(JsonNode step) {
        JsonNode target = step.path("target");
        JsonNode first = target.isArray() ? target.path(0) : target;
        if (first.isMissingNode() || first.isNull()) return "(no target)";
        String name = first.path("name").asText("");
        String value = first.path("value").asText("");
        return "\"" + (name.isBlank() ? value : name) + "\" (" + first.path("strategy").asText("") + ")";
    }

    private static String valueHint(JsonNode step) {
        if (step.path("secret").asBoolean(false)) return "•••(secret)";
        return "\"" + step.path("value").asText("") + "\"";
    }

    private static String waitHint(JsonNode step) {
        JsonNode wf = step.path("waitFor");
        if (wf.has("url")) return "the page " + wf.path("url").asText();
        return targetHint(step);
    }

    private static String expectHint(JsonNode step) {
        JsonNode expect = step.path("expect");
        if (expect.isMissingNode()) return targetHint(step);
        StringBuilder sb = new StringBuilder();
        if (expect.has("url")) sb.append("URL matches ").append(expect.path("url").asText());
        if (expect.has("visible")) sb.append(sb.isEmpty() ? "" : ", ").append(targetHint(step)).append(" is visible");
        if (expect.has("text")) sb.append(sb.isEmpty() ? "" : ", ").append("text is \"")
                .append(expect.path("text").asText()).append("\"");
        return sb.isEmpty() ? expect.toString() : sb.toString();
    }
}
