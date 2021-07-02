/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 105:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 318:
/***/ ((module) => {

module.exports = eval("require")("@octokit/rest");


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
const core = __nccwpck_require__(105);
const { Octokit } = __nccwpck_require__(318);

function ms_to_months(ms) {
  return ms / 1000 / 60 / 60 / 24 / (365 / 12);
}

function first_release(r) {
  if (r.name[0] !== "v") return false;
  const name = r.name.substring(1);
  return name.split(".")[2] === "0";
}

async function name_and_date(r, octokit) {
  const commit = await octokit.rest.repos.getCommit({
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

async function sorted_releases(org, repo, octokit) {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
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
    const tags = await octokit.paginate(octokit.rest.repos.listTags, {
      owner: org,
      repo: repo,
      per_page: 100,
    });
    const reduced = await Promise.all(
      tags.filter(first_release).map((x) => name_and_date(x, octokit))
    );
    reduced.sort((r1, r2) => r1.minor - r2.minor);
    return reduced;
  }
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

async function calc_releases(releases, months, min_releases, release_date) {
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

async function calc_nep29(packages, export_to_env, octokit) {
  const release_date = core.getInput("release-date");
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const months = core.getInput(`deprecate-${pkg.name}-after`);
    const min_releases = core.getInput(`min-${pkg.name}-releases`);
    core.debug(
      `Determining versions for ${pkg.name} with a ${months} months / ${min_releases} releases policy.`
    );
    try {
      const releases = await sorted_releases(pkg.name, pkg.repo, octokit);

      const min_max = await calc_releases(
        releases,
        months,
        min_releases,
        release_date
      );
      core.setOutput(`min-${pkg.name}`, min_max["min"]);
      core.setOutput(`max-${pkg.name}`, min_max["max"]);
      if (export_to_env) {
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

try {
  let token = core.getInput("token");
  if (!token)
    // local testing
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
    const packages = [
      { name: "python", repo: "cpython" },
      { name: "numpy", repo: "numpy" },
    ];
    calc_nep29(packages, export_to_env, octokit).catch((r) =>
      core.setFailed(r)
    );
  }
} catch (error) {
  core.setFailed(error.message);
}

})();

module.exports = __webpack_exports__;
/******/ })()
;