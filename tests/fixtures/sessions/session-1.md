---
name: docker-volume-mount
description: Mount docker volumes correctly across host/container boundaries
tool-trace: trace-session-1
---
# Session 1 — unrelated docker volume issue

User asked how to bind-mount a host directory into a container; we discussed
`docker run -v $PWD:/app:ro` and SELinux `:z` flag.
