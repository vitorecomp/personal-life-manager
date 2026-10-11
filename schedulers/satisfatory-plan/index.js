let recipes = [
	{
		name: "turbo",
		depends: [
			{
				name: "ore",
				qt:10
			}
		]
	},{
		name: "ore",
		depends: []
	},
]



const resolve = (name) => {
	let recipe = recipes.filter(recipe => recipe.name == name)[0]
	recipe.make = recipe.depends.map(({name}) => {
		return resolve(name)
	})
	return recipe;
}




let recipe = resolve('turbo')
console.log(JSON.stringify(recipe))


let maked = []
let nivel = []
let i = 0

const isPossible = (base, maked) => {
	let resolved = base.make.filter(
		(iten) => maked.filter(item => item == iten.name).length > 0
		
	)
	if(resolved.length == base.make.length){
		return [base.name]
	}

	return base.make.map((dependence) => isPossible(dependence, maked)[0])
}

while(maked.filter(item => item == 'turbo').length == 0){
	console.log('======')
	console.log(maked)
	console.log(i++)
	

	maked = maked.concat(isPossible(recipe, maked))
	if(i > 10)
		break
}

console.log(maked)