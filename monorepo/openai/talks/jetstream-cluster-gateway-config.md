Setting up 3 JetStream clusters, each with 3 nodes, and a full mesh of gateway connections between them:

**Directory structure:**
- configs/
    - cluster1/
        - node1.conf
        - node2.conf
        - node3.conf
    - cluster2/
        - node4.conf
        - node5.conf
        - node6.conf
    - cluster3/
        - node7.conf
        - node8.conf
        - node9.conf

**Configuration files for each node:**

Replace `CLUSTER_ID` and `NODE_ID` according to your cluster and node.

```
// configs/cluster{CLUSTER_ID}/node{NODE_ID}.conf

listen: 0.0.0.0:422{NODE_ID}
server_name: node{NODE_ID}

jetstream {
  store_dir: "./data/cluster{CLUSTER_ID}/node{NODE_ID}"
  max_mem_store: 1G
  max_file_store: 10G
}

gateway {
  name: "cluster{CLUSTER_ID}_gw"
  listen: 0.0.0.0:722{NODE_ID}

  remotes: [
    {
      url: "nats://localhost:722{GATEWAY_NODE_ID}"
    }
  ]
}

cluster {
  name: "cluster{CLUSTER_ID}"
  listen: 0.0.0.0:622{NODE_ID}

  routes [
    nats-route://localhost:622{NEIGHBOR_NODE_ID}
  ]
}
```

Make sure to replace `{GATEWAY_NODE_ID}` with the corresponding gateway node IDs for each remote.

For example:
- Cluster 1 node 1 would have `{GATEWAY_NODE_ID}` replaced with `24`, `25`, `27`, `28`, `37`, and `38`.
- Cluster 1 node 2 would have `{GATEWAY_NODE_ID}` replaced with `14`, `15`, `27`, `28`, `37`, and `38`, and so on.

**Example TypeScript code:**

Install the required packages:
```bash
npm install nats nats.ws
```

```typescript
// index.ts
import { connect } from 'nats';
import { JSONCodec } from "nats/lib/nats-base-client/mod";

(async () => {
  const clusterURLs = [
    'nats://localhost:4221',
    'nats://localhost:4224',
    'nats://localhost:4227'
  ];

  const connections = await Promise.all(clusterURLs.map(url => connect({ url })));

  const jc = JSONCodec();

  await Promise.all(connections.map((nc, i) => {
    return nc.publish("announce.cluster", jc.encode({ clusterId: i + 1 }));
  }));

  const subscriptionPromises = connections.map(async (nc, i) => {
    const subjectPrefix = `cluster${i + 1}.event`;
    const subscription = nc.subscribe(`${subjectPrefix}.>`);

    console.log(`Connected to ${clusterURLs[i]} and subscribed to ${subjectPrefix}.>`);

    for await (const m of subscription) {
      console.log(`Received message on cluster ${i + 1} - subject: ${m.subject}, data: ${m.data}`);
    }
  });

  await Promise.all(subscriptionPromises);
})();
```

This TypeScript code connects to the first node of each cluster and sets up subscriptions with appropriate subject prefixes `cluster1.event.>`, `cluster2.event.>`, and `cluster3.event.>`. As soon as the subscriptions are set up, each connected instance sends an announcement on the `announce.cluster` subject.
<eof>

In this example, we will create three JetStream clusters, each one having three nodes. Each cluster will be connected to the other clusters using a full mesh of gateway connections. The configurations for each node will be provided, followed by example TypeScript code for interacting with the JetStream clusters using NATS.

Configuration

Cluster 1 nodes:

`node1.conf`
```
port: 4222
name: node1_cluster1

jetstream {
  store_dir: "./node1_cluster1"
  max_mem: 1G
  max_file: 2G
}

cluster {
  name: cluster1
  listen: localhost:6222
  routes [
    nats-route://localhost:6223
    nats-route://localhost:6224
  ]
}

gateway {
  name: gateway_cluster1
  listen: localhost:8222
  gateways [
    {
      name: gateway_cluster2
      urls: ["localhost:8223"]
    }
    {
      name: gateway_cluster3
      urls: ["localhost:8224"]
    }
  ]
}
```

`node2.conf`
```
port: 4223
name: node2_cluster1

jetstream {
  store_dir: "./node2_cluster1"
  max_mem: 1G
  max_file: 2G
}

cluster {
  name: cluster1
  listen: localhost:6223
  routes [
    nats-route://localhost:6222
    nats-route://localhost:6224
  ]
}

gateway {
  name: gateway_cluster1
  listen: localhost:8223
}

```

`node3.conf`
```
port: 4224
name: node3_cluster1

jetstream {
  store_dir: "./node3_cluster1"
  max_mem: 1G
  max_file: 2G
}

cluster {
  name: cluster1
  listen: localhost:6224
  routes [
    nats-route://localhost:6222
    nats-route://localhost:6223
  ]
}

gateway {
  name: gateway_cluster1
  listen: localhost:8224
}
```

Cluster 2 and cluster 3 nodes will have similar configurations, with the appropriate name updates and port changes.

Example TypeScript code

```typescript
import { connect, StringCodec } from "nats";
import { v4 as uuidv4 } from "uuid";

(async () => {
  const sc = StringCodec();
  const nc = await connect({ servers: "localhost:4222" });

  const streamName = "example";

  // Add a stream
  await nc.request(
    "$JS.API.STREAM.CREATE." + streamName,
    sc.encode(
      JSON.stringify({
        name: streamName,
        subjects: ["example.*"],
        storage: "memory",
        max_consumers: 32,
      })
    )
  );

  // Publish messages to the stream
  for (let i = 0; i < 10; i++) {
    await nc.publish("example." + uuidv4(), sc.encode("Message " + i));
  }

  // Create a durable consumer
  await nc.request(
    "$JS.API.CONSUMER.CREATE." + streamName,
    sc.encode(
      JSON.stringify({
        durable_name: "example-consumer",
        config: { ack_policy: "none" },
      })
    )
  );

  // Subscribe to the durable consumer
  const sub = nc.subscribe("example.*");

  (async () => {
    for await (const m of sub) {
      console.log(`Received: ${sc.decode(m.data)}`);
      m.respond(sc.encode("+ACK"));
    }
  })().catch((err) => {
    console.log(`Consumer error: ${err.message}`);
  });

  setTimeout(() => {
    sub.unsubscribe();
    nc.close();
  }, 5000);
})();
```

In the code above, we are setting up a connection to the first cluster, creating a stream and publishing messages to it. Additionally, we are creating a durable consumer for the stream, and asynchronously listening for messages to be processed.

Replace `'localhost:4222'` with the appropriate address for connecting to cluster 2 or cluster 3, respectively. This will allow you to interact with all three JetStream clusters using the same typescript code.

With this configuration and code, you will have three interconnected JetStream clusters, each having three nodes. The full mesh of gateway connections ensures high availability and fault tolerance. The example TypeScript code then demonstrates how to interact with these clustered JetStream instances using NATS.
