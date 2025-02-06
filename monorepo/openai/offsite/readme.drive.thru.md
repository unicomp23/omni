Below is the MermaidJS code for a diagram illustrating an example of CQRS and event sourcing in a drive-thru ordering system. It shows the order with items being added and removed while highlighting snapshots and deltas with sequence numbers (seqnos).

```mermaid
sequenceDiagram
  participant Customer as Customer
  participant Command as Command Model
  participant EventStore as Event Store
  participant EventHandler as Event Handler
  participant Query as Query Model

  Customer->>Command: Add burger to order (seqno 1)
  Command->>EventStore: Store Add burger event
  EventStore->>EventHandler: Notify Add burger event (seqno 1)
  EventHandler->>Query: Update order with burger (snapshot, seqno 1)

  Customer->>Command: Add drink to order (seqno 2)
  Command->>EventStore: Store Add drink event
  EventStore->>EventHandler: Notify Add drink event (seqno 2)
  EventHandler->>Query: Update order with drink (delta, seqno 2)

  Customer->>Command: Remove burger from order (seqno 3)
  Command->>EventStore: Store Remove burger event
  EventStore->>EventHandler: Notify Remove burger event (seqno 3)
  EventHandler->>Query: Update order removing burger (delta, seqno 3)

  Customer->>Query: Request current order
  Query->>Customer: Show order with drink (snapshot + deltas: 1, 2, 3)
```
