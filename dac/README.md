# parcel developer documentation

This repository contains the developer documentation for parcel. Documentation is written
in Markdown and published to the Atlassian npm repository.

## What's inside

Inside this directory you will find the content and navigation structure for your docs. These will
be published at:

https://developer.atlassian.com/platform/tool/parcel

```
README.md
node_modules/
package.json
.gitignore
.spelling
content/platform/parcel/
    apis/
        index.md
        sample.md
    products/
        index.md
        sample.md
    images/
        screenshot.jpg
    getting-started.md
    index.md
data/
    parcel.json
```

As you can see, the configuration and folder structures are simple, and you only generate the files
that you need to document your product or service.

Once the installation is done, you can run some commands inside this folder:

## Preview your documentation locally

You can instantly preview changes to your documentation set as you make them using
[live preview](https://developer.atlassian.com/platform/writing-toolkit/viewing-your-docs-locally/).
See the [Getting started](https://developer.atlassian.com/platform/writing-toolkit/getting-started/) guide for
instructions on setting up live preview.

## Organize your documentation

Your developer documentation should be organized broadly into two categories of content:

- **Guides:** Content in this section consists of handcrafted tutorials, overviews, and guides.
- **Reference:** Content in the Reference section is strictly limited to informational material, such
  as REST API content.

See the [organize your docs](https://developer.atlassian.com/platform/writing-toolkit/organizing-your-docs/)
section of the _Writing toolkit_ for guidance on organizing your content and page templates.

## Release your documentation

The initial release of your documentation set will require help from the DAC team.
After that, further changes can be released by publishing your documentation set to npm.

See the [releasing your documentation guide](http://developer.atlassian.com/platform/writing-toolkit/publishing-process/)
for full details.

## Metadata

Certain [metadata](https://developer.atlassian.com/platform/writing-toolkit/metadata/) (YAML
frontmatter) is required in order for the navigation and other page elements, such as the
page title and last published date, to work properly.

## Spellcheck your docs

You can run the following commands inside the project folder to check for spelling errors:

- `npm test`: Spellchecks Markdown files
- `npm run-script spellcheck`: Interactively fix or ignore spelling errors

You may optionally enable spellcheck as a part of your Bitbucket Pipelines build.

The dictionary is unique to your repository. Edit the `.spelling` file in the root of this
repository to add words to the dictionary. Note that you may need to turn on the ability to see
hidden files and folders to see the `.spelling` file.

## Contributors

Pull requests, issues, and comments welcome. For pull requests:

- follow the existing style
- separate unrelated changes into multiple pull requests

For bigger changes, make sure you start a discussion first by creating
an issue and explaining the intended change.

Atlassian requires contributors to sign a Contributor License Agreement,
known as a CLA. This serves as a record stating that the contributor is
entitled to contribute the code, documentation, or translation to the project
and is willing to have it used in distributions and derivative works
(or is willing to transfer ownership).

Prior to accepting your contributions, we ask that you please follow the
link below to digitally sign the CLA:

- [Contributor License Agreement](https://atlassian.wufoo.com/forms/contributor-license-agreement/)

## License

Copyright (c) 2016-2018 Atlassian and others.
Apache 2.0 licensed, see [LICENSE.txt](LICENSE.txt) file.
