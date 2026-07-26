# Plugin Manifest

> AI Social OS Plugin Layer

Version: 2.0.0

Status: Stable

---

# Overview

Manifest là tài liệu mô tả Plugin.

Plugin Runtime chỉ đọc Manifest để hiểu Plugin.

Core không đọc Source Code.

---

# Manifest Structure

```yaml
id:

name:

version:

author:

description:

license:

homepage:

repository:

runtime:

permissions:

capabilities:

tools:

events:

entrypoint:

dependencies:

configuration:
```

---

# Example

```yaml
id: weather-plugin

name: Weather Plugin

version: 1.0.0

author: AI Social

runtime: nodejs

entrypoint: index.js

permissions:

- internet

capabilities:

- weather.query

tools:

- current_weather
```

---

# Required Fields

- id
- version
- runtime
- entrypoint

---

# Optional Fields

- logo
- documentation
- screenshots
- pricing
- categories

---

# Permissions

Ví dụ.

```yaml
permissions:

- internet

- storage

- secrets

- filesystem.read

- filesystem.write
```

---

# Capability Declaration

```yaml
capabilities:

- translation.text

- weather.query

- search.web
```

---

# Tool Declaration

```yaml
tools:

- search

- summarize

- generate
```

---

# Dependency Declaration

```yaml
dependencies:

- ai-runtime>=2.0

- storage-plugin>=1.2
```

---

# Validation

Manifest được kiểm tra.

- Schema
- Signature
- Version
- Compatibility

---

# Summary

Manifest là hợp đồng giữa Plugin và AI Social OS.