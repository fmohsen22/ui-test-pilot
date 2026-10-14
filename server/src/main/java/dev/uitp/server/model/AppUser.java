package dev.uitp.server.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "app_user")
public class AppUser extends PanacheEntity {

    @Column(nullable = false, unique = true)
    public String email;

    @Column(nullable = false)
    public String firstName;

    @Column(nullable = false)
    public String lastName;

    public String position;

    @Column(nullable = false)
    public String passwordHash;

    @Column(nullable = false)
    public boolean admin;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    public static AppUser findByEmail(String email) {
        return find("lower(email)", email.toLowerCase()).firstResult();
    }
}
