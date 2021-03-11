export default import('./async').then(
  (dependency) => { 
    return {
      children: document.head.children,
      loadDependency: dependency.default
    }    
  }
);
