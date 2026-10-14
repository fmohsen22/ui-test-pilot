package dev.uitp.server.auth;

import dev.uitp.server.model.SessionToken;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;

/** Resolves "Authorization: Bearer <token>" into the request-scoped CurrentUser. */
@Provider
public class AuthFilter implements ContainerRequestFilter {

    @Inject
    CurrentUser currentUser;

    @Override
    @Transactional
    public void filter(ContainerRequestContext ctx) {
        String header = ctx.getHeaderString("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return;
        SessionToken token = SessionToken.findValid(header.substring("Bearer ".length()).trim());
        if (token != null) currentUser.set(token.user);
    }
}
