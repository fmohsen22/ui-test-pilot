package dev.uitp.server.runner;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

/** Reads/writes scenario JSON files under <project-dir>/scenarios, path-traversal-safe. */
@ApplicationScoped
public class ScenarioStore {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Inject
    UitpCli cli;

    /** <project-dir>/scenarios when it exists (the uitp init convention), else the project dir itself. */
    public Path scenariosRoot() {
        Path conventional = cli.projectDir().resolve("scenarios");
        return Files.isDirectory(conventional) ? conventional : cli.projectDir();
    }

    /** feature-folder -> list of {id, path, title, tags} */
    public Map<String, List<Map<String, Object>>> tree() {
        Path root = scenariosRoot();
        Map<String, List<Map<String, Object>>> out = new TreeMap<>();
        if (!Files.isDirectory(root)) return out;
        try (Stream<Path> walk = Files.walk(root)) {
            walk.filter(p -> p.toString().endsWith(".json"))
                    .sorted(Comparator.comparing(Path::toString))
                    .forEach(p -> {
                        Path rel = root.relativize(p);
                        Path relToProject = cli.projectDir().relativize(p);
                        String feature = rel.getNameCount() > 1 ? rel.getParent().toString() : "(root)";
                        Map<String, Object> entry = new TreeMap<>();
                        entry.put("file", rel.toString().replace('\\', '/'));
                        entry.put("path", relToProject.toString().replace('\\', '/'));
                        try {
                            JsonNode json = MAPPER.readTree(p.toFile());
                            entry.put("id", json.path("id").asText(rel.getFileName().toString()));
                            entry.put("title", json.path("title").asText(""));
                            List<String> tags = new ArrayList<>();
                            json.path("tags").forEach(t -> tags.add(t.asText()));
                            entry.put("tags", tags);
                            entry.put("steps", json.path("steps").size());
                        } catch (IOException e) {
                            entry.put("id", rel.getFileName().toString());
                            entry.put("title", "(unreadable JSON: " + e.getMessage() + ")");
                        }
                        out.computeIfAbsent(feature, k -> new ArrayList<>()).add(entry);
                    });
        } catch (IOException e) {
            throw new RuntimeException("cannot walk scenarios dir " + root, e);
        }
        return out;
    }

    public String read(String relPath) {
        try {
            return Files.readString(resolve(relPath), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new NotFoundException("scenario not found: " + relPath);
        }
    }

    public void write(String relPath, String content) {
        try {
            MAPPER.readTree(content); // must at least be valid JSON before touching disk
        } catch (IOException e) {
            throw new BadRequestException("not valid JSON: " + e.getMessage());
        }
        try {
            Path target = resolve(relPath);
            Files.createDirectories(target.getParent());
            Files.writeString(target, content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("cannot write " + relPath, e);
        }
    }

    /** Resolves a path like "scenarios/auth/login.json" inside the project dir; rejects escapes. */
    public Path resolve(String relPath) {
        if (relPath == null || relPath.isBlank()) throw new BadRequestException("path required");
        Path base = cli.projectDir();
        Path resolved = base.resolve(relPath).normalize();
        if (!resolved.startsWith(base) || !resolved.toString().endsWith(".json")) {
            throw new BadRequestException("invalid scenario path");
        }
        return resolved;
    }
}
