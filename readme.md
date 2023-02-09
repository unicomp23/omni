## Async notifications architecture

```mermaid
flowchart TD
    Vandenberg(Vandenberg) -->|publish-stream-start| Kafka{Kafka}
    Kafka -->|subscribe-stream-start| StreamNotifier(StreamNotifier)
    StreamNotifier -->|publish-stream-start| Kafka(Kafka)
    Kafka -->|subscribe-stream-start| Client(Client)
```
