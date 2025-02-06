#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <uuid/uuid.h>
#include <librdkafka/rdkafka.h>

static int run = 1;

static void stop(int sig) {
    run = 0;
}

void create_topic(const char *brokers, const char *topic_base) {
    rd_kafka_t *rk;
    rd_kafka_conf_t *conf;
    rd_kafka_conf_res_t conf_err;
    rd_kafka_resp_err_t resp_err;

    conf = rd_kafka_conf_new();
    conf_err = rd_kafka_conf_set(conf, "bootstrap.servers", brokers, NULL, 0);
    if (conf_err) {
        fprintf(stderr, "Failed to set broker: %s\n", rd_kafka_err2str((rd_kafka_resp_err_t)conf_err));
        exit(1);
    }

    conf_err = rd_kafka_conf_set(conf, "debug", "all", NULL, 0);
    if (conf_err) {
        fprintf(stderr, "Failed to set debug: %s\n", rd_kafka_err2str((rd_kafka_resp_err_t)conf_err));
        exit(1);
    }

    rk = rd_kafka_new(RD_KAFKA_PRODUCER, conf, NULL, 0);
    if (!rk) {
        fprintf(stderr, "Failed to create new Kafka producer instance\n");
        exit(1);
    }

    rd_kafka_AdminOptions_t *options = rd_kafka_AdminOptions_new(rk, RD_KAFKA_ADMIN_OP_CREATETOPICS);
    rd_kafka_AdminOptions_set_request_timeout(options, 60000, NULL, 0);

    rd_kafka_NewTopic_t *new_topics[1];

    uuid_t uuid;
    char uuid_str[37];

    uuid_generate_random(uuid);
    uuid_unparse_lower(uuid, uuid_str);

    char topic_name[256];
    snprintf(topic_name, sizeof(topic_name), "%s_%s", topic_base, uuid_str);

    new_topics[0] = rd_kafka_NewTopic_new(topic_name, 1, -1, NULL, 0);

    rd_kafka_queue_t *queue;
    rd_kafka_event_t *event;

    queue = rd_kafka_queue_new(rk);

    rd_kafka_CreateTopics(rk, new_topics, 1, options, queue);

    if (run) {
        event = rd_kafka_queue_poll(queue, -1);
    }
    if (rd_kafka_event_error(event)) {
        fprintf(stderr, "Failed to create topic %s: %s\n", topic_name, rd_kafka_event_error_string(event));
    } else {
        printf("Topic %s created\n", topic_name);
    }

    // list the topics
    const rd_kafka_metadata_t *metadata;
    resp_err = rd_kafka_metadata(rk, 1, NULL, &metadata, 5000);
    if (resp_err) {
        fprintf(stderr, "Failed to fetch metadata: %s\n", rd_kafka_err2str(resp_err));
        exit(1);
    }
    printf("Listing %d topics:\n", metadata->topic_cnt);
    for (int i = 0; i < metadata->topic_cnt; i++) {
        printf("Topic: %s\n", metadata->topics[i].topic);
    }
    rd_kafka_metadata_destroy(metadata);

    rd_kafka_event_destroy(event);
    rd_kafka_queue_destroy(queue);
    rd_kafka_NewTopic_destroy(new_topics[0]);
    rd_kafka_AdminOptions_destroy(options);
    rd_kafka_destroy(rk);
}

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <bootstrap_servers> <topic_base>\n", argv[0]);
        return 1;
    }

    signal(SIGINT, stop);
    signal(SIGTERM, stop);

    const char *brokers = argv[1];
    const char *topic_base = argv[2];

    create_topic(brokers, topic_base);

    return 0;
}
