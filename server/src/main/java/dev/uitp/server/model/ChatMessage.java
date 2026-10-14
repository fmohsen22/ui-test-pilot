package dev.uitp.server.model;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.List;

@Entity
@Table(name = "chat_message")
public class ChatMessage extends PanacheEntity {

    @ManyToOne(optional = false)
    public Conversation conversation;

    /** user | assistant | tool */
    @Column(nullable = false, length = 16)
    public String role;

    @Column(nullable = false, columnDefinition = "text")
    public String content;

    /** set when role == tool: which uitp tool ran (snapshot, run_scenario, ...) */
    public String toolName;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    public static List<ChatMessage> ofConversation(Conversation c) {
        return list("conversation = ?1 order by id", c);
    }
}
