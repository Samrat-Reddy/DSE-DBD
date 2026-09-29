"""Structured (one JSON object per line) application logging."""

import json
import logging
import sys
from datetime import UTC, datetime

# Attributes every LogRecord has; anything else was passed via `extra=` and is
# emitted as a structured field.
_STANDARD_ATTRS = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(
            {key: value for key, value in record.__dict__.items() if key not in _STANDARD_ATTRS}
        )
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # SQL echo is controlled by DB_ECHO on the engine, never by the root level,
    # so bound parameters are not logged by accident.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
