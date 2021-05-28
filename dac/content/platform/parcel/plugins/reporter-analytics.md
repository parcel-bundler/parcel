---
title: 'Plugins: Atlassian Reporter Analytics'
platform: platform
product: parcel
category: devguide
subcategory: plugins
date: '2021-03-23'
---

# Atlassian Reporter Analytics

The `@atlassian/parcel-reporter-analytics` is a custom reporter plugin to gather additional analytic information and publishes them to Sentry and Amplitude.

Some items being tracked:

- if the build succeeded or failed
- if the build failed, why? (does include syntax errors)
- build times
- CPU usage
