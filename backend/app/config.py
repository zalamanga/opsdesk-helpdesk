import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "sqlite+pysqlite:///.local/opsdesk.db"))
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        origin.strip().rstrip("/") for origin in os.getenv("OPSDESK_ALLOWED_ORIGINS", "http://localhost:8091,http://127.0.0.1:8091").split(",") if origin.strip()
    ))
    cookie_secure: bool = field(default_factory=lambda: os.getenv("OPSDESK_COOKIE_SECURE", "false").lower() == "true")
    demo_mode: bool = field(default_factory=lambda: os.getenv("OPSDESK_DEMO_MODE", "false").lower() == "true")
    session_hours: int = 24
    login_limit: int = 8
    login_ip_limit: int = 64
    login_window_seconds: int = 900

    def __post_init__(self):
        if not self.allowed_origins or "*" in self.allowed_origins:
            raise ValueError("Configure exact OPSDESK_ALLOWED_ORIGINS; wildcard origins are forbidden")
        if self.session_hours <= 0 or self.login_limit <= 0 or self.login_ip_limit <= 0 or self.login_window_seconds <= 0:
            raise ValueError("Session and rate-limit settings must be positive")
