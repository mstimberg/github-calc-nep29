# github-calc-nep29
GitHub Action to calculate [Python](https://python.org) and [numpy](https://numpy.org) release versions that should be
supported according to [NEP 29](https://numpy.org/neps/nep-0029-deprecation_policy.html).

Several big projects in the Scientific Python ecosystem decided to adopt a common “time window-based” policy for support
of Python and NumPy versions, formalized as [NEP 29](https://numpy.org/neps/nep-0029-deprecation_policy.html).

The recommend policy is to support:
* all minor versions of **Python** released **42 months** prior to the project, and at minimum the **two latest minor versions**.
* all minor versions of **numpy** released **24 months** prior to the project, and at minimum the **last three minor versions**.

This GitHub Action calculates the respective versions of Python and numpy according to this policy (or a variant of it),
based on the current date or a prospective release date. By using this action, projects can automatically adapt the
versions used for testing and/or packaging.

## Required input arguments

### `token`

A GitHub API token to query the GitHub repositories of Python and numpy for releases.
Such a token is automatically provided by GitHub Actions and can be accessed as `$ {{secrets.GITHUB_TOKEN}}`.

## Optional input arguments

### `release-date`

The targeted release date of the project in format `YYYY-MM-DD`. If not given, defaults to the current date.
For targets in the future, only the currently existing Python/numpy releases will be taken into account.

### `export-to-env`

The Python/numpy versions are always available as outputs of the GitHub Action step. For convenience, they will also
be exported as environment variables, except if this option is set to `false`. Note that environment variables use
underscores where the outputs use hyphens, e.g. `MIN_PYTHON` instead of `min-python`.

### `include-release-candidates`

When set to `true`, release candidates (i.e. versions like `3.11.0rc1`) will also be considered when determining the `max-version`.

### `include-beta-releases`

When set to `true`, beta versions (i.e. versions like `3.11.0b2`) will also be considered when determining the `max-version`.

### `deprecate-python-after`

The cutoff (in months) for previous minor versions of Python to support. Defaults to 42.

### `deprecate-numpy-after`

The cutoff (in months) for previous minor versions of numpy to support. Defaults to 24.

### `min-python-releases`

The minimum number of minor Python releases to support. Defaults to 2.

### `min-numpy-releases`

The minimum number of minor numpy releases to support. Defaults to 3.

## Outputs

### `min-python`

The oldest minor Python release to support according to the policy.

### `max-python`

The newest minor Python release to support according to the policy.

### `min-numpy`

The oldest minor numpy release to support according to the policy.

### `max-numpy`

The newest minor numpy release to support according to the policy.

## Example use

### Use within the same job

```yaml
on: [push]

jobs:
  test_job:
    runs-on: ubuntu-latest
    name: Test calc-NEP29 action
    steps:
      - name: Calculate NEP29 releases
        uses: mstimberg/github-calc-nep29@v0.6
        id: nep29
        with:
            token: ${{ secrets.GITHUB_TOKEN }}
      - name: Get the minimum/maximum Python and numpy versions
        run: |
          echo "Using output from previous step:"
          echo "Minimum Python: ${{ steps.nep29.outputs.min-python }}, Maximum Python: ${{ steps.nep29.outputs.max-python }}"
          echo "Minimum numpy: ${{ steps.nep29.outputs.min-numpy }}, Maximum numpy ${{ steps.nep29.outputs.max-numpy }}"
          echo "Using environment variables:"
          echo "Minimum Python: $MIN_PYTHON, Maximum Python: $MAX_PYTHON"
          echo "Minimum numpy: $MIN_NUMPY, Maximum numpy $MAX_NUMPY"
```

### Use in a separate job

If you need to use the output in a separate job (e.g. because jobs are running on different operating systems), you will
have to specify the outputs of the job as the output of the step:

```yaml
jobs:
  get_versions:
    name: "Determine Python and numpy versions"
    runs-on: ubuntu-latest
    outputs:
      min-python: ${{ steps.nep29.outputs.min-python }}
      max-python: ${{ steps.nep29.outputs.max-python }}
    steps:
      - name: "calculate versions according to NEP29"
        id: nep29
        uses: mstimberg/github-calc-nep29@v0.6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

testing:
  needs: [get_python_versions]
  name: "Python ${{ matrix.python-version }} on ${{ matrix.os }}"
  runs-on: ${{ matrix.os }}
  strategy:
    matrix:
      os: [ubuntu-20.04, windows-2019, macOS-10.15]      
      python-version: ["${{ needs.get_python_versions.outputs.min-python }}", "${{ needs.get_python_versions.outputs.max-python }}"]
      - name: Setup Conda and Python
      uses: conda-incubator/setup-miniconda@v2
      with:
        python-version: ${{ matrix.python-version }}
```
