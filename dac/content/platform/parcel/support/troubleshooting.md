---
title: Troubleshooting
platform: platform
product: parcel
category: devguide
subcategory: support
date: '2021-05-26'
---

# Troubleshooting

Having troubles building with Parcel? We have compiled some self-serve help to get you back to developing.

## Clearing the cache

The team is hard at work ensuring the cache is reliable and correct. There are times where something goes wrong and can surface as a wide variety of issues. More times than not, you should be able to delete the `.parcel-cache`. If the issue persists, reach out the appropriate support channel.

## Performance problems

Parcel has a built-in CPU profiler, powered by the V8 Profiler. This is useful for debugging performance problems in Parcel itself.
So if you encounter high CPU usage and can reproduce it, please follow the following steps:

- Run Parcel from a tty (e.g. an interactive terminal)
- Press ctrl-e and wait for Parcel to output a message noting that profiling has begun
- Reproduce the problem
- Press ctrl-e again and wait for Parcel to output a message noting the profiling has ended and the location of the trace
- View the trace in a Chromium browser under `chrome://tracing`
- Compress the trace (zip, gzip, etc.) and upload to the appropriate support channel
