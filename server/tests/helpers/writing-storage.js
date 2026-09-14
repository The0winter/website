import {createWritingStorage} from '../../services/writing-storage.js';

export function memoryWritingStorage() {
  const objects = new Map();
  const client = {writes: 0, failWrites: false, async send(command) {
    const {Key, Body} = command.input;
    switch (command.constructor.name) {
      case 'PutObjectCommand':
        if (client.failWrites) throw Error('Simulated object storage outage');
        client.writes++; objects.set(Key, Body); return {};
      case 'GetObjectCommand':
        if (!objects.has(Key)) throw Error('Missing object');
        return {ContentLength: Buffer.byteLength(objects.get(Key)), Body: {transformToString: async () => objects.get(Key)}};
      case 'DeleteObjectCommand': objects.delete(Key); return {};
      default: throw Error('Unexpected storage command');
    }
  }};
  return Object.assign(createWritingStorage({client, bucket: 'isolated-draft-test'}), {objects, client});
}
