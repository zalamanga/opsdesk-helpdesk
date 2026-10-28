from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(Payload):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.lower()

    @field_validator("password", mode="before")
    @classmethod
    def password_unchanged(cls, value):
        # Password spaces are significant; all other input strings are trimmed.
        return value

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class NewTicket(Payload):
    title: str = Field(min_length=5, max_length=160)
    description: str = Field(min_length=10, max_length=10000)
    category: Literal["access", "hardware", "network", "software", "other"]
    priority: Literal["low", "normal", "high", "critical"]


class Versioned(Payload):
    expected_version: StrictInt = Field(ge=1)


class Assignment(Versioned):
    assignee_id: StrictInt | None


class Transition(Versioned):
    status: Literal["open", "in_progress", "resolved"]
    note: str | None = Field(default=None, max_length=10000)


class NewComment(Versioned):
    body: str = Field(min_length=1, max_length=10000)
    internal: StrictBool
