/** Ordered matching-block count equivalent to difflib.SequenceMatcher(autojunk=False). */
export function matchingBlockCount<T>(frozen:T[],live:T[]):number {
    
    const b2j=new Map<T,number[]>();for(let j=0;j<live.length;j++){const positions=b2j.get(live[j])??[];positions.push(j);b2j.set(live[j],positions);}
    const queue:[number,number,number,number][]=[[0,frozen.length,0,live.length]];let common=0;
    while(queue.length){const[alo,ahi,blo,bhi]=queue.pop()!;let besti=alo,bestj=blo,bestsize=0;let previous=new Map<number,number>();for(let i=alo;i<ahi;i++){const current=new Map<number,number>();for(const j of b2j.get(frozen[i])??[]){if(j<blo)continue;if(j>=bhi)break;const size=(previous.get(j-1)??0)+1;current.set(j,size);if(size>bestsize){besti=i-size+1;bestj=j-size+1;bestsize=size;}}previous=current;}
        // With no junk, the dynamic-programming block is already maximal.
        if(bestsize){common+=bestsize;if(alo<besti&&blo<bestj)queue.push([alo,besti,blo,bestj]);if(besti+bestsize<ahi&&bestj+bestsize<bhi)queue.push([besti+bestsize,ahi,bestj+bestsize,bhi]);}
    }return common;
}
