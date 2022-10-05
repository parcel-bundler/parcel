# `atlassian-parcel-query`

A CLI for linking a dev version of Parcel into a project.

## Installation

Clone and run `yarn`, then `cd packages/dev/atlassian-parcel-link && yarn link`
to make the `atlassian-parcel-link` and `atlassian-parcel-unlink` binaries globally available.

## Usage

In an @atlassian/parcel project root (e.g., Jira):

```sh
$ atlassian-parcel-link
```

## Cleanup

To restore the project to its default Parcel install:

```sh
$ atlassian-parcel-unlink
```
