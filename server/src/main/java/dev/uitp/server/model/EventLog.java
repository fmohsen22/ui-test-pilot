package dev.uitp.server.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "event_log")
public class EventLog extends PanacheEntity {

    @Column(nullable = false)
    public Instant ts = Instant.now();

    /** INFO | ERROR */
    @Column(nullable = false, length = 8)
    public String level;

    public String userEmail;

    @Column(nullable = false)
    public String action;

    @Column(columnDefinition = "text")
    public String detail;

    public static void log(String level, String userEmail, String action, String detail) {
        EventLog e = new EventLog();
        e.level = level;
        e.userEmail = userEmail;
        e.action = action;
        e.detail = detail != null && detail.length() > 20000 ? detail.substring(0, 20000) : detail;
        e.persist();
    }
}
