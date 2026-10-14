package dev.uitp.server.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;

/** One execution of a scenario through the Regression UI — the Results menu's data. */
@Entity
@Table(name = "test_run")
public class TestRun extends PanacheEntity {

    @Column(nullable = false)
    public Instant ts = Instant.now();

    @Column(nullable = false)
    public String scenarioPath;

    public String scenarioId;

    @Column(nullable = false, length = 16)
    public String browser;

    @Column(nullable = false)
    public boolean passed;

    public int exitCode;

    public int attempts;

    public boolean healed;

    public long durationMs;

    public String userEmail;

    /** Relative artifact path of the final screenshot (served via /api/regression/artifact). */
    public String screenshot;

    @Column(columnDefinition = "text")
    public String reportJson;
}
