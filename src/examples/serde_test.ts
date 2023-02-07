import {AirCoreFrame, Coordinates} from "../../proto/generated/devinternal_pb";

console.log("running")

const coord = new AirCoreFrame({
    sendTo: new Coordinates({dbKey: {kafkaTopic: "topic"}})
});

const bytes = coord.toBinary();
const coord_2 = AirCoreFrame.fromBinary(bytes);

const kafkaTopic = coord_2.sendTo?.dbKey?.kafkaTopic;
if(kafkaTopic) console.log(`out: ${kafkaTopic}`);
