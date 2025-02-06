```mermaid
sequenceDiagram
    participant LJ as Late Joiner
    participant EJ as Early Joiner
    participant CH as Command Handler
    participant ES as Event Store
    participant SS as Snapshot Store
    participant EH as Event Handler

    Note over EJ,CH: Early Joiner raises hand

    EJ->>+CH: Send Command (Raise Hand)
    CH->>+ES: Get latest sequence number
    ES->>-CH: Return sequence number (e.g., 42)
    CH->>CH: Calculate next sequence number (e.g., 43)
    CH->>+EH: Apply RaiseHand event for EJ
    EH->>-CH: Return updated state (EJ HandRaised)
    CH->>+ES: Save new RaiseHand event for EJ with sequence number 43
    ES->>-CH: Confirm event saved
    CH->>EJ: Return updated state (EJ HandRaised)

    EJ->>EJ: Interact with chat room (Hand Raised)

    Note over LJ,CH: Late Joiner enters chat room

    CH->>+SS: Check for snapshot
    SS->>-CH: Return latest snapshot (e.g., at seq 40)
    CH->>LJ: Return snapshot state
    LJ->>+ES: Get events since snapshot (seq 40)
    ES->>-LJ: Return events 41 (LowerHand), 42 (RaiseHand), 43 (EJ RaiseHand)
    LJ->>LJ: Apply events to snapshot state
    LJ-->>LJ: Late Joiner has updated state

    LJ->>LJ: Interact with chat room (EJ Hand Raised)

    Note over LJ,CH: Late Joiner raises hand

    LJ->>+CH: Send Command (Raise Hand)
    CH->>+ES: Get latest sequence number
    ES->>-CH: Return sequence number (e.g., 43)
    CH->>CH: Calculate next sequence number (e.g., 44)
    CH->>+EH: Apply RaiseHand event for LJ
    EH->>-CH: Return updated state (LJ HandRaised)
    CH->>+ES: Save new RaiseHand event for LJ with sequence number 44
    ES->>-CH: Confirm event saved
    CH->>LJ: Return updated state (LJ HandRaised)

    LJ->>LJ: Interact with chat room (LJ Hand Raised)

    Note over EJ,CH: Early Joiner is notified about Late Joiner's raised hand

    CH->>EJ: Notify about updated state (LJ HandRaised)

    EJ->>EJ: Interact with chat room (LJ Hand Raised)
```

In this sequence diagram, there are two users: an early joiner and a late joiner. The early joiner raises their hand in the chat room first, and then the late joiner enters the chat room. The late joiner gets the current state of the chat room from the snapshot and event store, raises their hand, and interacts with the chat room. The early joiner receives a notification about the late joiner's raised hand and continues to interact with the chat room. The sequence emphasizes the sequence numbers used in event sourcing and CQRS systems to maintain the order of events and apply them correctly to the chat room state.
