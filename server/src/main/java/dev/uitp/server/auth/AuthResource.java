package dev.uitp.server.auth;

import dev.uitp.server.model.AppUser;
import dev.uitp.server.model.EventLog;
import dev.uitp.server.model.SessionToken;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;

@Path("/api/auth")
@Produces(MediaType.APPLICATION_JSON)
public class AuthResource {

    private static final SecureRandom RANDOM = new SecureRandom();

    @Inject
    CurrentUser currentUser;

    @ConfigProperty(name = "uitp.admin-emails")
    java.util.Optional<String> adminEmails;

    @ConfigProperty(name = "uitp.session-hours")
    long sessionHours;

    public record RegisterRequest(String email, String firstName, String lastName,
                                  String position, String password) {
    }

    public record LoginRequest(String email, String password) {
    }

    @POST
    @Path("/register")
    @Transactional
    public Map<String, Object> register(RegisterRequest req) {
        if (req == null || blank(req.email()) || blank(req.firstName())
                || blank(req.lastName()) || blank(req.password())) {
            throw new BadRequestException("email, firstName, lastName and password are required");
        }
        if (AppUser.findByEmail(req.email()) != null) {
            throw new BadRequestException("this email is already registered");
        }
        AppUser user = new AppUser();
        user.email = req.email().trim().toLowerCase();
        user.firstName = req.firstName().trim();
        user.lastName = req.lastName().trim();
        user.position = req.position() == null ? "" : req.position().trim();
        user.passwordHash = Passwords.hash(req.password());
        user.admin = isAdminEmail(user.email) || AppUser.count() == 0;
        user.persist();
        EventLog.log("INFO", user.email, "auth.register", "admin=" + user.admin);
        return session(user);
    }

    @POST
    @Path("/login")
    @Transactional
    public Map<String, Object> login(LoginRequest req) {
        AppUser user = req == null || blank(req.email()) ? null : AppUser.findByEmail(req.email());
        if (user == null || !Passwords.verify(req.password() == null ? "" : req.password(), user.passwordHash)) {
            EventLog.log("ERROR", req == null ? null : req.email(), "auth.login.failed", null);
            throw new NotAuthorizedException("invalid credentials");
        }
        EventLog.log("INFO", user.email, "auth.login", null);
        return session(user);
    }

    @GET
    @Path("/me")
    public Map<String, Object> me() {
        AppUser u = currentUser.require();
        return userJson(u);
    }

    private Map<String, Object> session(AppUser user) {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        SessionToken token = new SessionToken();
        token.token = HexFormat.of().formatHex(raw);
        token.user = user;
        token.expiresAt = Instant.now().plus(Duration.ofHours(sessionHours));
        token.persist();
        return Map.of("token", token.token, "user", userJson(user));
    }

    private Map<String, Object> userJson(AppUser u) {
        return Map.of("email", u.email, "firstName", u.firstName, "lastName", u.lastName,
                "position", u.position == null ? "" : u.position, "admin", u.admin);
    }

    private boolean isAdminEmail(String email) {
        return Arrays.stream(adminEmails.orElse("").split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .anyMatch(s -> s.equalsIgnoreCase(email));
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
