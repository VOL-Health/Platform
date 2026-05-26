(function(){
  const STORAGE_KEY = "volSelectedDemoCommunityId";
  const LAST_STORAGE_KEY = "volLastDemoCommunityId";
  const DATA_URL = "data/demo-communities.json";
  let cachedPayload = null;

  function slugify(value){
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getStoredId(){
    try{
      return sessionStorage.getItem(STORAGE_KEY) || "";
    }catch(error){
      return "";
    }
  }

  function setStoredId(id){
    try{
      sessionStorage.setItem(STORAGE_KEY, id);
      localStorage.setItem(LAST_STORAGE_KEY, id);
    }catch(error){
      // Demo state still works in memory when storage is unavailable.
    }
  }

  function getLastId(){
    try{
      return localStorage.getItem(LAST_STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || "";
    }catch(error){
      return "";
    }
  }

  function pickRotatingId(communities){
    if(!communities.length) return "";
    const lastId = getLastId();
    const lastIndex = communities.findIndex((community) => community.id === lastId || slugify(community.communityName) === lastId);
    return communities[(lastIndex + 1) % communities.length].id;
  }

  function normalizeCommunity(community){
    const id = community.id || slugify(community.communityName || community.sourceCommunityName);
    return { ...community, id };
  }

  async function loadDemoCommunities(){
    if(cachedPayload) return cachedPayload;
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if(!response.ok) throw new Error(`Unable to load ${DATA_URL}`);
    const payload = await response.json();
    const communities = Array.isArray(payload.communities)
      ? payload.communities.map(normalizeCommunity)
      : [];
    cachedPayload = { ...payload, communities };
    return cachedPayload;
  }

  async function getSelectedDemoCommunity(){
    const payload = await loadDemoCommunities();
    const communities = payload.communities || [];
    let storedId = getStoredId();
    if(!storedId) storedId = pickRotatingId(communities);
    const selected = communities.find((community) => community.id === storedId || slugify(community.communityName) === storedId) || communities[0] || null;
    if(selected) setStoredId(selected.id);
    return selected;
  }

  async function setSelectedDemoCommunity(id){
    const payload = await loadDemoCommunities();
    const communities = payload.communities || [];
    const selected = communities.find((community) => community.id === id || slugify(community.communityName) === id) || communities[0] || null;
    if(selected) setStoredId(selected.id);
    return selected;
  }

  async function selectNextDemoCommunity(){
    const payload = await loadDemoCommunities();
    const communities = payload.communities || [];
    if(!communities.length) return null;
    const currentId = getStoredId() || getLastId();
    const currentIndex = communities.findIndex((community) => community.id === currentId || slugify(community.communityName) === currentId);
    const selected = communities[(currentIndex + 1) % communities.length];
    setStoredId(selected.id);
    return selected;
  }

  window.VolDemoCommunityState = {
    storageKey: STORAGE_KEY,
    lastStorageKey: LAST_STORAGE_KEY,
    slugify,
    loadDemoCommunities,
    getSelectedDemoCommunity,
    setSelectedDemoCommunity,
    selectNextDemoCommunity
  };
})();
