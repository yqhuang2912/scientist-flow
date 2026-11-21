export type TemplateRelease = {
  version: number
  parentVersion: number | null
  publishedAt: string
}

export type TemplateVersionState = {
  currentVersion: number | null
  releases: TemplateRelease[]
  draftPublished: boolean
}

// A lane carries an edge to an older release. When two branches share a
// parent, both edges converge on its lane; a straight history uses one lane.
export function versionTreeRows(releases: TemplateRelease[]) {
  const lanes: (number | null)[] = []
  return releases.map((release) => {
    const incoming = lanes.flatMap((version, i) =>
      version === null ? [] : [i]
    )
    let lane = lanes.indexOf(release.version)
    if (lane < 0) {
      const free = lanes.indexOf(null)
      lane = free < 0 ? lanes.length : free
    }
    lanes[lane] = null
    let parentLane: number | null = null
    if (release.parentVersion !== null) {
      const existing = lanes.indexOf(release.parentVersion)
      parentLane = existing < 0 ? lane : existing
      lanes[parentLane] = release.parentVersion
    }
    return { ...release, lane, parentLane, incoming }
  })
}
