FROM alpine:3.19
RUN adduser -D sandbox
USER sandbox
WORKDIR /workspace
CMD ["bash", "-s"]
