#!/bin/bash
set -euo pipefail

ensure_docker_access() {
    if docker info >/dev/null 2>&1; then
        return
    fi

    if [ -z "${SHASTA_RUN_WITH_DOCKER_GROUP:-}" ] &&
        command -v sg >/dev/null 2>&1 &&
        getent group docker >/dev/null 2>&1 &&
        getent group docker | awk -F: -v user="$(id -un)" '
            {
                split($4, users, ",")
                for (i in users) {
                    if (users[i] == user) {
                        found = 1
                    }
                }
            }
            END { exit found ? 0 : 1 }
        ' &&
        ! id -nG | tr ' ' '\n' | grep -qx docker; then
        printf 'Current shell has not picked up the docker group; re-running with sg docker...\n'
        printf -v quoted_cwd '%q' "$PWD"
        printf -v quoted_script '%q' "$0"
        quoted_args=''
        for arg in "$@"; do
            printf -v quoted_arg '%q' "$arg"
            quoted_args+=" ${quoted_arg}"
        done
        exec sg docker -c "cd ${quoted_cwd} && SHASTA_RUN_WITH_DOCKER_GROUP=1 ${quoted_script}${quoted_args}"
    fi

    printf 'Docker is not accessible from this shell; docker info output follows:\n' >&2
    docker info
}

ensure_docker_access "$@"

# Ensure SSH agent is running
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    eval $(ssh-agent)
    export SSH_AUTH_SOCK
fi

# Start the containers with build
docker compose up -d --build

echo "Development environment is ready!"
echo "You can connect using: ssh -p 2222 root@localhost"
