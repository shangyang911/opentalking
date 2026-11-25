import assert from "node:assert/strict";
import test from "node:test";
import { startPlayback } from "../src/features/conversation/webrtc";

for (const failure of ["offer", "local", "signaling", "remote", null]) {
  test(`WebRTC initialization ${failure ? `cleans up after ${failure} failure` : "keeps a successful connection open"}`, async () => {
    const originals = Object.fromEntries(
      ["window", "fetch", "MediaStream", "RTCPeerConnection", "RTCSessionDescription"].map(
        (name) => [name, Reflect.get(globalThis, name)],
      ),
    );
    let peer: FakePeer;
    const video = { srcObject: null, play: async () => {}, pause() {} };
    class FakePeer {
      closed = false;
      iceGatheringState = "complete";
      localDescription = { type: "offer", sdp: "offer" };
      constructor() { peer = this; }
      addEventListener() {}
      addTransceiver() {}
      async createOffer() {
        if (failure === "offer") throw new Error("offer failed");
        return this.localDescription;
      }
      async setLocalDescription() {
        if (failure === "local") throw new Error("local failed");
      }
      async setRemoteDescription() {
        if (failure === "remote") throw new Error("remote failed");
      }
      close() { this.closed = true; }
    }
    Object.assign(globalThis, {
      window: { location: { href: "http://localhost/", pathname: "/" } },
      MediaStream: class { getTracks() { return []; } },
      RTCPeerConnection: FakePeer,
      RTCSessionDescription: class {},
      fetch: async (url: string) => {
        if (url.includes("ice-config")) return new Response("{}");
        if (failure === "signaling") return new Response("signaling failed", { status: 502 });
        return Response.json({ type: "answer", sdp: "answer" });
      },
    });
    try {
      const playback = startPlayback("sess_test", video as unknown as HTMLVideoElement);
      if (failure) {
        await assert.rejects(playback, /failed/);
        assert.equal(peer!.closed, true);
        assert.equal(video.srcObject, null);
      } else {
        const result = await playback;
        assert.equal(peer!.closed, false);
        assert.equal(result.pc, peer!);
        assert.equal(video.srcObject, result.remoteStream);
      }
    } finally {
      Object.assign(globalThis, originals);
    }
  });
}
