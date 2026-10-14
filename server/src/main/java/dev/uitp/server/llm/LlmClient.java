package dev.uitp.server.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Minimal OpenAI-compatible chat-completions client (function calling included).
 * Works against api.openai.com or ANY internal gateway exposing the same
 * POST {base-url}/chat/completions contract — the base URL, key and model are
 * plain config. No SDK dependency, just java.net.http + Jackson.
 */
@ApplicationScoped
public class LlmClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(20))
            .build();

    @ConfigProperty(name = "llm.base-url")
    String baseUrl;

    @ConfigProperty(name = "llm.api-key")
    java.util.Optional<String> apiKeyOpt;

    @ConfigProperty(name = "llm.model")
    String model;

    private String apiKey() {
        return apiKeyOpt.orElse("");
    }

    public boolean configured() {
        return !apiKey().isBlank();
    }

    public String model() {
        return model;
    }

    /**
     * messages: OpenAI-format array; tools: OpenAI-format tool definitions (nullable).
     * Returns choices[0].message as JsonNode (may contain content and/or tool_calls).
     */
    public JsonNode chat(ArrayNode messages, ArrayNode tools) {
        if (!configured()) {
            throw new IllegalStateException(
                    "no LLM configured: set UITP_LLM_API_KEY (and UITP_LLM_BASE_URL for a non-OpenAI gateway)");
        }
        ObjectNode body = MAPPER.createObjectNode();
        body.put("model", model);
        body.set("messages", messages);
        if (tools != null && !tools.isEmpty()) {
            body.set("tools", tools);
            body.put("tool_choice", "auto");
        }
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl.replaceAll("/+$", "") + "/chat/completions"))
                    .timeout(Duration.ofMinutes(4))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("LLM HTTP " + response.statusCode() + ": " + truncate(response.body()));
            }
            JsonNode root = MAPPER.readTree(response.body());
            JsonNode message = root.path("choices").path(0).path("message");
            if (message.isMissingNode()) {
                throw new IllegalStateException("LLM response without choices[0].message: " + truncate(response.body()));
            }
            return message;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("LLM call failed: " + e, e);
        }
    }

    private static String truncate(String s) {
        return s != null && s.length() > 800 ? s.substring(0, 800) + "…" : s;
    }
}
