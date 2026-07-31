package dev.uitp.server.auth;

import dev.uitp.server.model.AppUser;
import jakarta.enterprise.context.RequestScoped;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotAuthorizedException;

@RequestScoped
public class CurrentUser {

    private AppUser user;

    public void set(AppUser user) {
        this.user = user;
    }

    public AppUser get() {
        return user;
    }

    public AppUser require() {
        if (user == null) throw new NotAuthorizedException("login required");
        return user;
    }

    public AppUser requireAdmin() {
        AppUser u = require();
        if (!u.admin) throw new ForbiddenException("admin only");
        return u;
    }
}
