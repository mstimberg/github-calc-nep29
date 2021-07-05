const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");

// A few helper functions
function ms_to_months(ms) {
  return ms / 1000 / 60 / 60 / 24 / (365 / 12);
}

function first_release(r) {
  if (r.name[0] !== "v") return false;
  const name = r.name.substring(1);
  return name.split(".")[2] === "0";
}

function datestr_to_timestamp(datestr) {
  const regex = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:]+Z)?$/;
  const found = datestr.match(regex);
  return new Date(
      parseInt(found[1]),
      parseInt(found[2]) - 1, //monthidx, i.e. 0-based
      parseInt(found[3])
  );
}

class NEP29Calculator {
  constructor(octokit, export_to_env) {
    this.octokit = octokit;
    this.export_to_env = export_to_env;
  }

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

  async sorted_releases(org, repo) {
    const releases = await this.octokit.paginate(this.octokit.rest.repos.listReleases, {
      owner: org,
      repo: repo,
      per_page: 100,
    });
    if (releases.length) {
      const reduced = releases
          .map((x) => {
            x.name = x.tag_name;
            return x;
          })
          .filter(first_release)
          .map(function (x) {
            const parts = x.name.substring(1).split(".");
            return { major: parts[0], minor: parts[1], date: x.published_at };
          });
      reduced.sort((r1, r2) => r1.minor - r2.minor);
      return reduced;
    } else {
      const tags = await this.octokit.paginate(this.octokit.rest.repos.listTags, {
        owner: org,
        repo: repo,
        per_page: 100,
      });
      const reduced = await Promise.all(
          tags.filter(first_release).map((x) => this.name_and_date(x))
      );
      reduced.sort((r1, r2) => r1.minor - r2.minor);
      return reduced;
    }
  }

  async calc_releases(releases, months, min_releases, release_date) {
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
    core.debug(`Assuming release date: ${new Date(release_date).toDateString()}`);
    let accepted_releases = resolved.filter(
        (r) => ms_to_months(release_date - r.date) <= months
    );
    if (accepted_releases.length < min_releases) {
      accepted_releases = resolved.slice(resolved.length - min_releases);
    }
    return {
      min: accepted_releases[0].major + "." + accepted_releases[0].minor,
      max:
          accepted_releases[accepted_releases.length - 1].major +
          "." +
          accepted_releases[accepted_releases.length - 1].minor,
    };
  }

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
            release_date
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
  if (!token)
    token = process.env.GITHUB_TOKEN;
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
    calculator.calc_nep29(packages).catch((r) =>
      core.setFailed(r)
    );
  }
} catch (error) {
  core.setFailed(error.message);
}
