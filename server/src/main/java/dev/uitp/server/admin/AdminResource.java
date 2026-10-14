package dev.uitp.server.admin;

import dev.uitp.server.auth.CurrentUser;
import dev.uitp.server.model.AppUser;
import dev.uitp.server.model.ChatMessage;
import dev.uitp.server.model.Conversation;
import dev.uitp.server.model.EventLog;
import io.quarkus.panache.common.Page;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import java.util.List;
import java.util.Map;

@Path("/api/admin")
@Produces(MediaType.APPLICATION_JSON)
public class AdminResource {

    @Inject
    CurrentUser currentUser;

    @GET
    @Path("/users")
    public List<Map<String, Object>> users() {
        currentUser.requireAdmin();
        List<AppUser> users = AppUser.listAll();
        return users.stream().map(u -> Map.<String, Object>of(
                "email", u.email, "firstName", u.firstName, "lastName", u.lastName,
                "position", u.position == null ? "" : u.position,
                "admin", u.admin, "createdAt", u.createdAt.toString(),
                "conversations", Conversation.count("user", u))).toList();
    }

    @GET
    @Path("/logs")
    public List<Map<String, Object>> logs(@QueryParam("level") String level,
                                          @QueryParam("page") @jakarta.ws.rs.DefaultValue("0") int page) {
        currentUser.requireAdmin();
        var query = level == null || level.isBlank()
                ? EventLog.findAll(io.quarkus.panache.common.Sort.descending("id"))
                : EventLog.find("level = ?1 order by id desc", level.toUpperCase());
        List<EventLog> logs = query.page(Page.of(page, 100)).list();
        return logs.stream().map(e -> Map.<String, Object>of(
                "ts", e.ts.toString(), "level", e.level,
                "user", e.userEmail == null ? "" : e.userEmail,
                "action", e.action, "detail", e.detail == null ? "" : e.detail)).toList();
    }

    @GET
    @Path("/conversations")
    public List<Map<String, Object>> allConversations() {
        currentUser.requireAdmin();
        List<Conversation> list = Conversation.list("order by updatedAt desc");
        return list.stream().map(c -> Map.<String, Object>of(
                "id", c.id, "title", c.title, "user", c.user.email,
                "updatedAt", c.updatedAt.toString(),
                "messages", ChatMessage.count("conversation", c))).toList();
    }
}
