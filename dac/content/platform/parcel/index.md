---
title: Parcel @ Atlassian
platform: platform
product: parcel
category: devguide
subcategory: intro
date: '2021-06-29'
---

{{% warning %}}
**Note:** The content is currently **under construction** as we release our initial docs.
{{% /warning %}}

{{% note %}}
**This space is not intended to house public Parcel docs**

See the [public documentation](https://v2.parceljs.org/).
{{% /note %}}

# Introduction

**Important links:** package: `@atlassian/parcel` / [repo](https://bitbucket.org/atlassian/parcel) / [public repo](https://github.com/parcel-bundler/parcel/) / [public docs](https://v2.parceljs.org/)

Parcel is a packager for the modern web with a focus on performance and modularity. It is developed with Atlassian's needs and scale at its core, while benefitting from contributions and resources of a healthy open source project.

Because of Atlassian's need for scale with Bitbucket and Jira, Atlassian distributes a fork with custom plugins and additional internal needs.

This space is intended to document Atlassian's needs / customizations when working with the `@atlassian/parcel` fork. Please read through the [public documentation](https://v2.parceljs.org/) for configurations, plugins, and other non-Atlassian specific needs.

Please see the [Code of Conduct](https://bitbucket.org/atlassian/parcel/src/bitbucket-integration/CODE_OF_CONDUCT.md) and [Contributing Guide](https://bitbucket.org/atlassian/parcel/src/bitbucket-integration/CONTRIBUTING.md) before contributions.

### Notable differences

- `@atlassian/parcel-config-atlassian` has been optimized as the default Atlassian configuration.
- To use pre-releases, use the tag `atlassian` such as: `"@atlassian/parcel": "2.0.0-atlassian.78"`

## Goals

- Deliver significant runtime performance improvements for Atlassian customers and build-time performance improvements for Atlassian engineers across all of our products.
- Be "The Atlassian packager". Provide a common service that encodes performance best practices and makes them available to all of our products with little burden on product engineers.

## Further reading

- [Confluence homepage + recent internal blogs](https://hello.atlassian.net/wiki/spaces/AFP/pages/910501663/Parcel+2)
- [External - Parcel 2 beta 3](https://v2.parceljs.org/blog/beta3/)
