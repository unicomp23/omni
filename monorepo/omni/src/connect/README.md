Here are the sequence diagrams for each method in the `OmniImpl` class:

1. publish

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    participant PubSub
    Client->>OmniImpl: publish(request)
    OmniImpl->>PubSub: publish(frame)
    PubSub-->>OmniImpl: Acknowledge
    OmniImpl-->>Client: Empty
```

2. getSnapshot

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    participant AnyDB
    Client->>OmniImpl: getSnapshot(sequence_number_path)
    OmniImpl->>AnyDB: fetch_snapshot(sequence_number_path)
    AnyDB-->>OmniImpl: Result
    OmniImpl-->>Client: GetSnapshotResponse
```

3. getDeltas

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    participant AnyDB
    Client->>OmniImpl: getDeltas(request)
    OmniImpl->>AnyDB: fetch_deltas(sequenceNumberPath, sequenceNumber)
    AnyDB-->>OmniImpl: Payloads
    OmniImpl-->>Client: GetDeltasResponse
```

4. publishWithTimeout

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    participant PubSub
    Client->>OmniImpl: publishWithTimeout(request)
    OmniImpl->>PubSub: publish(frame)
    PubSub-->>OmniImpl: Acknowledge
    OmniImpl-->>Client: DelayedUpsertResponse
```

5. publishWithTimeoutHeartbeats

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    participant PubSub
    Client->>OmniImpl: publishWithTimeoutHeartbeats(request)
    OmniImpl->>PubSub: publish(frame)
    PubSub-->>OmniImpl: Acknowledge
    OmniImpl-->>Client: Empty
```

6. ping

```mermaid
sequenceDiagram
    participant Client
    participant OmniImpl
    Client->>OmniImpl: ping(request)
    OmniImpl-->>Client: Empty
```

These diagrams show the interactions between the client, `OmniImpl`, `AnyDB`, and `PubSub` for each of the methods in the `OmniImpl` class.
