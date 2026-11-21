const sharedResources = new WeakSet()
const activeOwners = new Set()
const poolClearers = new Set()
const textureAnisotropySyncers = new Set()

export function markSharedResource(resource) {
  if (resource && (typeof resource === 'object' || typeof resource === 'function')) {
    sharedResources.add(resource)
    if (resource.userData && typeof resource.userData === 'object') {
      resource.userData.isShared = true
    }
  }
  return resource
}

export function isSharedResource(resource) {
  if (!resource) return false
  return sharedResources.has(resource) || Boolean(resource.userData?.isShared)
}

export function registerSharedPoolClearer(clearFn) {
  if (typeof clearFn === 'function') {
    poolClearers.add(clearFn)
  }
}

export function registerTextureAnisotropySyncer(syncFn) {
  if (typeof syncFn === 'function') {
    textureAnisotropySyncers.add(syncFn)
  }
}

export function getTextureAnisotropySyncers() {
  return textureAnisotropySyncers
}

export function acquireSharedPools(ownerToken) {
  if (ownerToken !== undefined && ownerToken !== null) {
    activeOwners.add(ownerToken)
  }
  return activeOwners.size
}

export function disposeAllSharedPools() {
  for (const clearFn of poolClearers) {
    clearFn()
  }
}

export function releaseSharedPools(ownerToken) {
  if (ownerToken !== undefined && ownerToken !== null) {
    activeOwners.delete(ownerToken)
  }
  if (activeOwners.size === 0) {
    disposeAllSharedPools()
  }
  return activeOwners.size
}

export function getActiveSharedPoolOwnerCount() {
  return activeOwners.size
}
