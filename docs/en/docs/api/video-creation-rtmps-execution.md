# Chunked RTMPS video creation: historical execution notes

This page preserves the documentation counterpart of the upstream chunked RTMPS
workflow. The current local demo exposes realtime conversation, video creation and
works; RTMPS publishing and its UI/API were removed before the directory migration.
This page is not a startup or acceptance guide for the current demo.

The upstream design sends generated H.264/AAC chunks to a bounded queue and a
continuous RTMPS connection while writing the final MP4 in parallel. Acceptance
requires the first published frame to arrive before the final MP4 is completed;
publishing an already finished MP4 does not meet that requirement.

Historical harness resources remain under `scripts/streaming/` and
`deploy/docker-compose.streaming-test.yml`. Their credentials, TLS configuration
and external services must be managed separately; do not regenerate credentials
merely to restart a service.

For the full historical procedure, see the
[Chinese upstream execution notes](../../../zh/docs/api/video-creation-rtmps-execution.md).
For the supported current workflows and startup command, see the
[local demo guide](../../usage/local-demo.md).
