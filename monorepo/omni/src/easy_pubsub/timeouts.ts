import {RedisClientType} from "redis";

export class timeouts {
    private constructor(
        private readonly client: RedisClientType,
    ) {
    }
    public static create(client: RedisClientType) {
        return new timeouts(client);
    }
    private readonly partitions = new Array<number>();
    public track_partitions(partitions: Array<number>) {
        this.partitions.length = 0;
        this.partitions.push(...partitions);
    }

}