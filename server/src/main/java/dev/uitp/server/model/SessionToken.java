package dev.uitp.server.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "session_token")
public class SessionToken extends PanacheEntity {

    @Column(nullable = false, unique = true, length = 64)
    public String token;

    @ManyToOne(optional = false)
    public AppUser user;

    @Column(nullable = false)
    public Instant expiresAt;

    public static SessionToken findValid(String token) {
        SessionToken t = find("token", token).firstResult();
        if (t == null || t.expiresAt.isBefore(Instant.now())) return null;
        return t;
    }
}
