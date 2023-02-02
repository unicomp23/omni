import {AirCoreFrame, SendTo} from "../proto/generated/devinternal_pb";
import {publisher} from "./publisher";
import {worker_subscriber} from "./worker_subscriber";
import {config} from "./config";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new SendTo({kafkaTopic: "topic"})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

console.log(`out: ${coord_2.sendTo?.kafkaTopic}`);

const config_ = config.create();
const publisher_ = publisher.create(config_);
const subscriber_ = worker_subscriber.create(config_);

const strand = async() => {
    for(;;) {
        const frame = await subscriber_.frames.get();
        console.log("frame:", frame.toJson())
    }
}
strand().then(() => { console.log("strand exit")});

publisher_.send(new AirCoreFrame({
    payload: {
        text: "some text"
    }
}));
