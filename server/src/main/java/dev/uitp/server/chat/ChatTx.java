package dev.uitp.server.chat;

import dev.uitp.server.model.ChatMessage;
import dev.uitp.server.model.Conversation;
import dev.uitp.server.model.EventLog;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

import java.time.Instant;

/**
 * Short, self-contained transactions for chat persistence. The model/runner
 * calls take minutes — they must NEVER run inside a DB transaction (the JTA
 * reaper aborts long transactions), so the resources call these around them.
 */
@ApplicationScoped
public class ChatTx {

    @Transactional
    public void userMessage(long conversationId, String content) {
        Conversation c = Conversation.findById(conversationId);
        ChatMessage m = new ChatMessage();
        m.conversation = c;
        m.role = "user";
        m.content = content;
        m.persist();
    }

    @Transactional
    public void toolMessage(long conversationId, String tool, String content) {
        Conversation c = Conversation.findById(conversationId);
        ChatMessage m = new ChatMessage();
        m.conversation = c;
        m.role = "tool";
        m.toolName = tool;
        m.content = content;
        m.persist();
    }

    @Transactional
    public void assistantMessage(long conversationId, String content, String titleFromFirstUserMessage) {
        Conversation c = Conversation.findById(conversationId);
        ChatMessage m = new ChatMessage();
        m.conversation = c;
        m.role = "assistant";
        m.content = content;
        m.persist();
        c.updatedAt = Instant.now();
        if (c.title.equals("New chat") && titleFromFirstUserMessage != null) {
            c.title = titleFromFirstUserMessage.length() > 60
                    ? titleFromFirstUserMessage.substring(0, 60) + "…" : titleFromFirstUserMessage;
        }
    }

    @Transactional
    public void log(String level, String userEmail, String action, String detail) {
        EventLog.log(level, userEmail, action, detail);
    }
}
