# Nightly encrypted backups (DECISIONS A31): the database and the files, with restic.
# pg_dump comes from the same PostgreSQL major version as the database (17).
FROM postgres:17.12-alpine

RUN apk add --no-cache restic tzdata
# Times in the crontab are Istanbul time (A17).
ENV TZ=Europe/Istanbul

COPY backup.sh restore.sh drill.sh health.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/*.sh

# Logs go to the container's output (docker compose logs backup).
CMD ["crond", "-f", "-l", "6"]
HEALTHCHECK --interval=1h --start-period=1m CMD ["health.sh"]
