package dev.uitp.server.chat;

import dev.uitp.server.auth.CurrentUser;
import dev.uitp.server.model.AppUser;
import dev.uitp.server.model.ChatMessage;
import dev.uitp.server.model.Conversation;
import dev.uitp.server.model.EventLog;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Path("/api/chat")
@Produces(MediaType.APPLICATION_JSON)
public class ChatResource {

    @Inject
    CurrentUser currentUser;

    @Inject
    Orchestrator orchestrator;

    @Inject
    ChatTx tx;

    public record NewMessage(String content, String browser) {
    }

    @GET
    @Path("/conversations")
    public List<Map<String, Object>> myConversations() {
        AppUser me = currentUser.require();
        List<Conversation> list = Conversation.list("user = ?1 order by updatedAt desc", me);
        return list.stream().map(c -> Map.<String, Object>of(
                "id", c.id, "title", c.title, "updatedAt", c.updatedAt.toString())).toList();
    }

    @GET
    @Path("/conversations/{id}")
    public Map<String, Object> conversation(@PathParam("id") long id) {
        Conversation c = owned(id);
        List<Map<String, Object>> messages = ChatMessage.ofConversation(c).stream()
                .map(m -> Map.<String, Object>of(
                        "role", m.role,
                        "content", m.content,
                        "toolName", m.toolName == null ? "" : m.toolName,
                        "at", m.createdAt.toString()))
                .toList();
        return Map.of("id", c.id, "title", c.title, "messages", messages);
    }

    /**
     * Deliberately NOT @Transactional: the model/runner work can take minutes and must
     * not hold a DB transaction (the JTA reaper aborts them after ~5 min). All writes
     * go through ChatTx's short transactions instead.
     */
    @POST
    @Path("/conversations/{id}/messages")
    public Map<String, Object> send(@PathParam("id") long id, NewMessage req) {
        if (req == null || req.content() == null || req.content().isBlank()) {
            throw new BadRequestException("message content required");
        }
        Conversation c = owned(id);
        String userContent = req.content().trim();
        tx.userMessage(c.id, userContent);

        List<ChatMessage> history = ChatMessage.ofConversation(c);
        Orchestrator.Reply reply;
        try {
            reply = orchestrator.respond(c, history, req.browser());
        } catch (Exception e) {
            tx.log("ERROR", c.user.email, "chat.respond", e.toString());
            reply = new Orchestrator.Reply("Something went wrong talking to the model or the runner: "
                    + e.getMessage(), List.of());
        }

        tx.assistantMessage(c.id, reply.text(), userContent);
        tx.log("INFO", c.user.email, "chat.message", "conversation=" + c.id
                + " tools=" + reply.events().size());
        return conversation(id);
    }

    @POST
    @Path("/conversations")
    @Transactional
    public Map<String, Object> create() {
        AppUser me = currentUser.require();
        Conversation c = new Conversation();
        c.user = me;
        c.title = "New chat";
        c.persist();
        return Map.of("id", c.id, "title", c.title);
    }

    private Conversation owned(long id) {
        AppUser me = currentUser.require();
        Conversation c = Conversation.findById(id);
        if (c == null) throw new NotFoundException();
        if (!c.user.id.equals(me.id) && !me.admin) throw new NotFoundException();
        return c;
    }
}
