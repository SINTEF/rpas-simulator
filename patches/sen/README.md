# Optional SEN patch (TCP-hub fallback only)

`0003-ether-fix-multicast-emulation-use-after-move.patch` fixes a use-after-move in
`components/ether/src/ether_transport.h` (still present on upstream `main` at the pinned
commit, see `upstream-ether-tcp-hub-crash.md`). It only bites when ether runs with
`busConfig.multicastDisabled: true` (TCP discovery hub emulating multicast) and two or more
remote processes join. The default multicast discovery this project uses is unaffected, so
the patch is **not applied** by the base image; apply it only if you switch a deployment to
the hub fallback described in `ARCHITECTURE.md` §5.
