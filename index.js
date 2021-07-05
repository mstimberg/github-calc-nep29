const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");

/** Number of ms in a day */
const one_day_ms = 24 * 60 * 60 * 1000;

// **** A few helper functions ****

/**
 * Convert a timestamp (or timestamp difference) in ms to months.
 * A month is defined as 365/12 = 30.42 days.
 * @param {number} ms - Time in milliseconds
 * @returns {number} Time in months
 */
function ms_to_months(ms) {
  return ms / 1000 / 60 / 60 / 24 / (365 / 12);
}

/**
 * Check whether a tag corresponds to a first minor release (e.g. 3.9.0).
 * @param {string} tag_name - The tag name
 * @returns {boolean} Whether the tag corresponds to a .0 release
 */
function first_release(tag_name) {
  if (tag_name[0] !== "v") return false;
  const name = tag_name.substring(1);
  return name.split(".")[2] === "0";
}

/**
 * Parse a string in the format 'YYYY-MM-DD' into a time stamp.
 * The date can also contain a time (e.g. ':T133405Z'), but this
 * time will be ignored.
 * @param {string} datestr - The date string
 * @returns {Date} The Date object, discarding any time information
 */
function datestr_to_timestamp(datestr) {
  const regex = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:]+Z)?$/;
  const found = datestr.match(regex);
  return new Date(
    parseInt(found[1]),
    parseInt(found[2]) - 1, //monthidx, i.e. 0-based
    parseInt(found[3])
  );
}

/**
 * Main class for the NEP 29 calculation.
 * @class
 */
class NEP29Calculator {
  /**
   * @param {object} octokit - The octokit object wrapping the GitHub API
   * @param {boolean} export_to_env - Whether to export environment variables.
   * @constructor
   */
  constructor(octokit, export_to_env) {
    this.octokit = octokit;
    this.export_to_env = export_to_env;
  }

  /**
   * Extract the date and the minor/major version for a GitHub release by checking the commit associated with it.
   * @param {object} r - A "release" object from the GitHub API
   * @returns {Promise<{date: string, major: string, minor: string}>}
   * @async
   */
  async name_and_date(r) {
    const commit = await this.octokit.rest.repos.getCommit({
      owner: "python",
      repo: "cpython",
      ref: r.commit.sha,
    });
    const name = r.name.substring(1);
    const parts = name.split(".");
    return {
      major: parts[0],
      minor: parts[1],
      date: commit.data.commit.committer.date,
    };
  }

  /**
   * Determine a list of all .0 releases for a project on GitHub.
   * @param {string} org - The name of the organization on GitHub (e.g. "python")
   * @param {string} repo - The name of the repository on GitHub (e.g. "cpython")
   * @returns {Promise<unknown[]|*>}
   */
  async sorted_releases(org, repo) {
    const releases = await this.octokit.paginate(
      this.octokit.rest.repos.listReleases,
      {
        owner: org,
        repo: repo,
        per_page: 100,
      }
    );
    if (releases.length) {
      const reduced = releases
        .map((x) => {
          x.name = x.tag_name;
          return x;
        })
        .filter((r) => first_release(r.name))
        .map(function (r) {
          const parts = r.name.substring(1).split(".");
          return { major: parts[0], minor: parts[1], date: r.published_at };
        });
      reduced.sort((r1, r2) => r1.minor - r2.minor);
      return reduced;
    } else {
      core.debug(
        `The ${org}/${repo} repository does not use GitHub releases, trying tags instead.`
      );
      const tags = await this.octokit.paginate(
        this.octokit.rest.repos.listTags,
        {
          owner: org,
          repo: repo,
          per_page: 100,
        }
      );
      const reduced = await Promise.all(
        tags
          .filter((r) => first_release(r.name))
          .map((x) => this.name_and_date(x))
      );
      reduced.sort((r1, r2) => r1.minor - r2.minor);
      return reduced;
    }
  }

  /**
   * Calculate the releases that should be supported according to NEP 29.
   * @param {Promise} releases - The releases as returned by `sorted_releases`.
   * @param {number} months - The number of months a release should be supported.
   * @param {number} min_releases - The minimum number of minor releases that should be supported.
   * @param {Date} release_date - The expected release date (if empty, defaults to `Date.now()`)
   * @param {string} name - The name of the package (for error messages mostly)
   * @returns {Promise<{min: string, max: string}>}
   * @async
   */
  async calc_releases(releases, months, min_releases, release_date, name) {
    let resolved = await releases;
    // transform dates into millisecond timestamps
    resolved = resolved.map((r) => {
      r.date = datestr_to_timestamp(r.date);
      return r;
    });
    if (!release_date) release_date = Date.now();
    else {
      try {
        release_date = datestr_to_timestamp(release_date);
      } catch (e) {
        throw new Error(
          `Could not parse release date '${release_date}', please use a 'YYYY-MM-DD' format.`
        );
      }
    }
    const release_date_str = new Date(release_date).toDateString();
    core.debug(`Assuming release date: ${release_date_str}`);
    if (release_date > Date.now() + one_day_ms) {
      core.warning(
        `The assumed release date ${release_date_str} is in the future, you should probably ignore max-${name}.`
      );
    }
    // Filter out releases that did not exist back at the time for release dates in the past
    const existing_releases = resolved.filter(
      (r) => release_date - r.date >= 0
    );
    core.debug(
      `${existing_releases.length} ${name} releases existed on ${release_date_str}.`
    );
    let accepted_releases = existing_releases.filter(
      (r) => ms_to_months(release_date - r.date) <= months
    );
    if (accepted_releases.length < min_releases) {
      core.debug(
        `Only ${accepted_releases.length} ${name} releases are less than ${months} months old. ` +
          `Using the ${min_releases} latest releases instead.`
      );
      accepted_releases = existing_releases.slice(
        existing_releases.length - min_releases
      );
      if (accepted_releases.length < min_releases) {
        core.warning(
          `Did only find ${
            accepted_releases.length
          } ${name} releases, not ${min_releases}, that already existed on ${new Date(
            release_date
          ).toDateString()}`
        );
      }
    }
    if (accepted_releases.length)
      return {
        min: accepted_releases[0].major + "." + accepted_releases[0].minor,
        max:
          accepted_releases[accepted_releases.length - 1].major +
          "." +
          accepted_releases[accepted_releases.length - 1].minor,
      };
    else
      throw new Error(
        `Could not find any releases for ${name} matching the criteria.`
      );
  }

  /**
   * Calculate the package versions that should be supported according to NEP 29 and set them as outputs of the GitHub
   * step. Optionally (if `export_to_env` has been set), also export the versions as environment variables.
   * @param packages - The packages to check (usually Python and numpy)
   * @returns {Promise<void>}
   * @async
   */
  async calc_nep29(packages) {
    const release_date = core.getInput("release-date");
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      const months = core.getInput(`deprecate-${pkg.name}-after`);
      const min_releases = core.getInput(`min-${pkg.name}-releases`);
      core.debug(
        `Determining versions for ${pkg.name} with a ${months} months / ${min_releases} releases policy.`
      );
      try {
        const releases = await this.sorted_releases(pkg.name, pkg.repo);
        const min_max = await this.calc_releases(
          releases,
          months,
          min_releases,
          release_date,
          pkg.name
        );
        core.setOutput(`min-${pkg.name}`, min_max["min"]);
        core.setOutput(`max-${pkg.name}`, min_max["max"]);
        if (this.export_to_env) {
          core.exportVariable(`min_${pkg.name}`.toUpperCase(), min_max["min"]);
          core.exportVariable(`max_${pkg.name}`.toUpperCase(), min_max["max"]);
        }
      } catch (e) {
        throw new Error(
          `Could not retrieve releases for '${pkg.name}' from github repository ${pkg.name}/${pkg.repo}:\n${e}`
        );
      }
    }
  }
}

try {
  let token = core.getInput("token");
  if (!token) token = process.env.GITHUB_TOKEN;
  if (!token) {
    core.setFailed(
      "You need to provide the GITHUB API token (available as ${{ secrets.GITHUB_TOKEN }}) as " +
        "the token argument, or store it in an environment variable named GITHUB_TOKEN."
    );
  } else {
    const export_to_env = core.getInput("export-to-env");
    const octokit = new Octokit({
      userAgent: "github-check-nep29 v0.1",
      auth: token,
    });
    const calculator = new NEP29Calculator(octokit, export_to_env);
    const packages = [
      { name: "python", repo: "cpython" },
      { name: "numpy", repo: "numpy" },
    ];
    calculator.calc_nep29(packages).catch((r) => core.setFailed(r));
  }
} catch (error) {
  core.setFailed(error.message);
}
